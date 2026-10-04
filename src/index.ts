import { config } from './config.js';
import { loadSubscriptions } from './subscriptions.js';
import { fetchSubscriptionVideos } from './sources/rss.js';
import { discoverByInterest } from './sources/search.js';
import { guessSpanish } from './filters/language.js';
import { dedupe, isBlocked, scoreVideo } from './rank.js';
import { annotateWithClaude } from './ai.js';
import { State } from './state.js';
import { renderDigest, toPlainText } from './format.js';
import { sendTelegram } from './notify/telegram.js';
import type { Video } from './types.js';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function runOnce(): Promise<void> {
  const now = new Date();
  const since = new Date(now.getTime() - config.lookbackHours * 3_600_000);

  const state = new State(config.stateFile);
  await state.load();

  // 1. Novedades de tus suscripciones (RSS, sin cuota de API)
  const subs = await loadSubscriptions(config.subscriptionsFile);
  log(`${subs.length} suscripciones cargadas`);

  const {
    videos: rawSubVideos,
    errors,
    okCount,
    retriesUsed,
  } = await fetchSubscriptionVideos(
    subs,
    since,
    config.concurrency,
    config.staggerMs,
    config.feedRetries,
  );

  if (retriesUsed > 0) log(`${retriesUsed} reintentos consumidos (YouTube limitando el ritmo)`);

  /** Fallo total: ningún canal respondió. No es un día tranquilo, es una avería. */
  const allFeedsFailed = okCount === 0 && subs.length > 0;

  if (errors.length) {
    log(`${errors.length} de ${subs.length} feeds fallaron:`);
    for (const e of errors.slice(0, 8)) log(`  ${e}`);
    if (errors.length > 8) log(`  … y ${errors.length - 8} más`);
  }

  if (allFeedsFailed) {
    log('');
    log('AVISO: ningún canal respondió, ni tras los reintentos. Como fallan TODOS,');
    log('lo más probable es un problema de red o que YouTube esté limitando esta IP,');
    log('no que tus IDs sean malos. Para distinguirlo:');
    log('  docker compose run --rm check     verifica los IDs uno por uno');
    log('Si check los da por válidos, baja CONCURRENCY o sube STAGGER_MS y reintenta.');
  } else {
    log(`${okCount} de ${subs.length} feeds OK`);
  }

  log(`${rawSubVideos.length} vídeos nuevos en las últimas ${config.lookbackHours}h`);

  // 2. Descubrimiento por temas (requiere API key)
  let rawDiscovery: Video[] = [];
  if (config.youtubeApiKey) {
    const subIds = new Set(subs.map((s) => s.channelId));
    for (const interest of config.interests) {
      try {
        const found = await discoverByInterest(
          interest,
          since,
          config.youtubeApiKey,
          config.discoveryPerInterest,
        );
        rawDiscovery.push(...found.filter((v) => !subIds.has(v.channelId)));
      } catch (err) {
        log(`descubrimiento "${interest}" falló: ${(err as Error).message}`);
      }
    }
    log(`${rawDiscovery.length} candidatos de descubrimiento`);
  } else {
    log('sin YOUTUBE_API_KEY: descubrimiento desactivado');
  }

  // 3. Filtrado: ya vistos, bloqueados, idioma
  const pipeline = (videos: Video[], enforceSpanish: boolean): Video[] =>
    dedupe(videos)
      .filter((v) => !state.has(v.id))
      .filter((v) => !isBlocked(v, config.blockKeywords))
      .filter((v) => !enforceSpanish || guessSpanish(v.title, v.description).isSpanish)
      .map((v) => scoreVideo(v, config.boostKeywords, now))
      .sort((a, b) => b.score - a.score);

  let subVideos = pipeline(
    rawSubVideos,
    config.spanishOnly && !config.keepAllSubscriptions,
  ).slice(0, config.maxSubscriptionItems);

  let discoveryVideos = pipeline(rawDiscovery, config.spanishOnly).slice(
    0,
    config.maxDiscoveryItems * 2,
  );

  // 4. Valoración opcional con Claude (solo sobre descubrimiento: las
  //    suscripciones ya las has elegido tú y no quieres que nadie las filtre)
  discoveryVideos = (
    await annotateWithClaude(discoveryVideos, config.anthropicApiKey, config.anthropicModel)
  ).slice(0, config.maxDiscoveryItems);

  if (subVideos.length === 0 && discoveryVideos.length === 0 && !allFeedsFailed) {
    log('nada nuevo que reportar');
    if (!config.dryRun) await state.save();
    return;
  }

  // 5. Entrega. El aviso viaja dentro del mensaje: si no, un fallo de red se
  //    lee como "hoy nadie publicó nada" y puede pasar semanas desapercibido.
  const warning = allFeedsFailed
    ? `Ninguno de los ${subs.length} canales respondió (red o límite de YouTube). ` +
      'La sección de suscripciones está incompleta.'
    : undefined;

  const html = renderDigest(subVideos, discoveryVideos, now, warning);
  console.log('\n' + toPlainText(html) + '\n');

  if (config.telegramBotToken && config.telegramChatId && !config.dryRun) {
    await sendTelegram(config.telegramBotToken, config.telegramChatId, html);
    log('digest enviado a Telegram');
  }

  if (!config.dryRun) {
    state.markSeen([...subVideos, ...discoveryVideos].map((v) => v.id), now);
    await state.save();
  }
}

function msUntil(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const target = new Date();
  target.setHours(h ?? 8, m ?? 0, 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  return target.getTime() - Date.now();
}

async function main(): Promise<void> {
  if (!config.dailyAt) {
    await runOnce();
    return;
  }

  log(`modo programado: ejecución diaria a las ${config.dailyAt} (TZ=${process.env.TZ ?? 'sistema'})`);

  // Equivalente a Persistent=true de systemd: al levantar el contenedor no
  // esperamos hasta mañana si la hora de hoy ya ha pasado.
  if (config.runOnStart) {
    log('RUN_ON_START: pasada inicial al arrancar');
    try {
      await runOnce();
    } catch (err) {
      log(`ERROR: ${(err as Error).message}`);
    }
  }

  for (;;) {
    const wait = msUntil(config.dailyAt);
    log(`próxima ejecución en ${Math.round(wait / 60_000)} min`);
    await new Promise((r) => setTimeout(r, wait));
    try {
      await runOnce();
    } catch (err) {
      log(`ERROR: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Verifica que cada channel ID del fichero corresponda a un canal real.
 *
 *   npm run check-subs
 *   docker compose run --rm check
 *
 * Usa el MISMO cliente HTTP que el digest (reintentos y cabeceras incluidos),
 * para que sus resultados sean directamente comparables. Antes no era así y eso
 * provocó un diagnóstico equivocado: el verificador usaba menos concurrencia,
 * no le limitaban el ritmo, y parecía que el problema estuviera en los IDs.
 */
import { XMLParser } from 'fast-xml-parser';
import { config } from '../config.js';
import { loadSubscriptions } from '../subscriptions.js';
import { describeFailure, fetchFeed, type FeedResponse } from '../sources/fetch-feed.js';

const parser = new XMLParser({ ignoreAttributes: false });

interface Result {
  channelId: string;
  fileTitle: string;
  res: FeedResponse;
  realTitle?: string;
  lastVideo?: string;
  lastDate?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check(channelId: string, fileTitle: string): Promise<Result> {
  const res = await fetchFeed(channelId);
  if (!res.ok || !res.xml) return { channelId, fileTitle, res };

  const doc = parser.parse(res.xml) as {
    feed?: { title?: string; author?: { name?: string }; entry?: unknown };
  };
  const entries = Array.isArray(doc.feed?.entry)
    ? doc.feed.entry
    : doc.feed?.entry
      ? [doc.feed.entry]
      : [];
  const first = entries[0] as { title?: string; published?: string } | undefined;

  return {
    channelId,
    fileTitle,
    res,
    realTitle: doc.feed?.author?.name ?? String(doc.feed?.title ?? ''),
    lastVideo: first?.title,
    lastDate: first?.published?.slice(0, 10),
  };
}

async function main(): Promise<void> {
  const subs = await loadSubscriptions(config.subscriptionsFile);
  console.log(
    `Verificando ${subs.length} canales de ${config.subscriptionsFile} ` +
      `(concurrencia ${config.concurrency}, con reintentos)\n`,
  );

  const results: Result[] = [];
  const queue = [...subs];
  const worker = async (slot: number) => {
    await sleep(slot * config.staggerMs);
    for (;;) {
      const sub = queue.shift();
      if (!sub) return;
      results.push(await check(sub.channelId, sub.title));
      await sleep(config.staggerMs);
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, (_, i) => worker(i)));

  const order = new Map(subs.map((s, i) => [s.channelId, i]));
  results.sort((a, b) => (order.get(a.channelId) ?? 0) - (order.get(b.channelId) ?? 0));

  const ok = results.filter((r) => r.res.ok);
  const failed = results.filter((r) => !r.res.ok);
  const retried = ok.filter((r) => r.res.attempts > 1);

  for (const r of results) {
    if (r.res.ok) {
      const name = r.realTitle ?? '(sin nombre)';
      const tries = r.res.attempts > 1 ? `  (${r.res.attempts} intentos)` : '';
      console.log(`  OK   ${r.channelId}  ${name}${tries}`);
      console.log(
        `       ${r.lastVideo ? `último: ${r.lastDate} "${r.lastVideo.slice(0, 60)}"` : 'sin vídeos'}`,
      );
    } else {
      console.log(`  FALLO ${r.channelId}  ${r.fileTitle}`);
      console.log(`       ${describeFailure(r.res)}`);
    }
  }

  console.log(`\nResumen: ${ok.length} válidos · ${failed.length} fallidos`);
  if (retried.length > 0) {
    console.log(
      `${retried.length} canales necesitaron reintentos: YouTube está limitando el ritmo ` +
        'desde esta IP. Es normal y los reintentos lo absorben.',
    );
  }

  if (failed.length === results.length && results.length > 0) {
    console.log(
      '\nFallan TODOS. Con reintentos de por medio, esto apunta a red o a un bloqueo\n' +
        'de YouTube a esta IP, no a los IDs. Prueba desde otra red, o baja CONCURRENCY.',
    );
  } else if (failed.length > 0) {
    console.log('\nCanales que no responden (revisa si siguen existiendo):');
    for (const r of failed) console.log(`  ${r.channelId}  ${r.fileTitle}`);
  }

  if (ok.length > 0) {
    console.log('\nFichero con los nombres reales:');
    console.log(ok.map((r) => `${r.channelId},,${r.realTitle ?? ''}`).join('\n'));
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

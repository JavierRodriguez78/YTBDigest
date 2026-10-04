/**
 * Convierte handles o URLs de canal en channel IDs reales, leyéndolos del
 * propio YouTube. Nunca inventa un ID: si no lo encuentra, lo dice.
 *
 *   npm run resolve-handles -- @midudev @DotCSV https://www.youtube.com/@Fireship
 *   npm run resolve-handles -- --file data/handles.txt > data/subscriptions.csv
 *   docker compose run --rm resolve @midudev @DotCSV
 *
 * Con YOUTUBE_API_KEY usa la API (1 unidad de cuota, fiable).
 * Sin ella, lee el HTML del canal buscando externalId.
 */
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

const CHANNEL_ID = /^UC[\w-]{22}$/;

function normalize(input: string): { kind: 'id' | 'handle' | 'legacy'; value: string } {
  const s = input.trim();

  const direct = s.match(/channel\/(UC[\w-]{22})/);
  if (direct?.[1]) return { kind: 'id', value: direct[1] };
  if (CHANNEL_ID.test(s)) return { kind: 'id', value: s };

  const at = s.match(/@([\w.-]+)/);
  if (at?.[1]) return { kind: 'handle', value: at[1] };

  const legacy = s.match(/\/(?:c|user)\/([\w.-]+)/);
  if (legacy?.[1]) return { kind: 'legacy', value: legacy[1] };

  return { kind: 'handle', value: s.replace(/^\/+/, '') };
}

async function viaApi(handle: string, kind: 'handle' | 'legacy'): Promise<string | null> {
  const param = kind === 'handle' ? 'forHandle' : 'forUsername';
  const value = kind === 'handle' ? `@${handle}` : handle;
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&${param}=${encodeURIComponent(value)}&key=${config.youtubeApiKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const data = (await res.json()) as { items?: Array<{ id?: string }> };
  return data.items?.[0]?.id ?? null;
}

async function viaHtml(handle: string, kind: 'handle' | 'legacy'): Promise<string | null> {
  const path = kind === 'handle' ? `@${handle}` : `c/${handle}`;
  const res = await fetch(`https://www.youtube.com/${path}`, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      // Sin esta cookie YouTube devuelve la pantalla de consentimiento en la UE.
      cookie: 'SOCS=CAI',
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'accept-language': 'es-ES,es;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTML HTTP ${res.status}`);

  const html = await res.text();
  for (const re of [/"externalId":"(UC[\w-]{22})"/, /"channelId":"(UC[\w-]{22})"/, /channel\/(UC[\w-]{22})/]) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function resolve(input: string): Promise<{ input: string; id: string | null; how: string }> {
  const { kind, value } = normalize(input);
  if (kind === 'id') return { input, id: value, how: 'ya era un ID' };

  if (config.youtubeApiKey) {
    try {
      const id = await viaApi(value, kind);
      if (id) return { input, id, how: 'API' };
    } catch (err) {
      console.error(`  (API falló para ${input}: ${(err as Error).message}, probando HTML)`);
    }
  }

  try {
    const id = await viaHtml(value, kind);
    return { input, id, how: id ? 'HTML' : 'no encontrado' };
  } catch (err) {
    return { input, id: null, how: `error: ${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let inputs: string[] = [];

  const fileFlag = args.indexOf('--file');
  if (fileFlag !== -1) {
    const path = args[fileFlag + 1];
    if (!path) throw new Error('--file necesita una ruta');
    const raw = await readFile(path, 'utf8');
    inputs = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } else {
    inputs = args;
  }

  if (inputs.length === 0) {
    console.error(
      'Uso:\n' +
        '  npm run resolve-handles -- @midudev @DotCSV\n' +
        '  npm run resolve-handles -- --file data/handles.txt > data/subscriptions.csv',
    );
    process.exit(1);
  }

  console.error(`Resolviendo ${inputs.length} canales${config.youtubeApiKey ? ' (con API key)' : ' (vía HTML)'}…`);

  const out: string[] = [];
  let failed = 0;

  for (const input of inputs) {
    const r = await resolve(input);
    if (r.id) {
      console.error(`  ${r.id}  ${input}  [${r.how}]`);
      out.push(`${r.id},,${input}`);
    } else {
      console.error(`  FALLO    ${input}  [${r.how}]`);
      failed++;
    }
  }

  // El CSV va a stdout para poder redirigirlo; los avisos van a stderr.
  if (out.length > 0) console.log(out.join('\n'));

  console.error(`\n${out.length} resueltos, ${failed} fallidos.`);
  if (failed > 0) console.error('Los fallidos no se escriben: revisa el handle a mano en el navegador.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

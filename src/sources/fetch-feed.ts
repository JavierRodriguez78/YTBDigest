/**
 * Cliente HTTP para los feeds RSS de YouTube.
 *
 * YouTube responde 404 (no 429) cuando decide limitar una ráfaga de peticiones
 * desde una misma IP. Un 404 por tanto NO prueba que el canal no exista: solo
 * lo damos por inexistente si sigue fallando después de varios reintentos
 * espaciados. Esto es lo que diferencia un canal borrado de un mal día de red.
 */

export interface FeedResponse {
  ok: boolean;
  status: number | 'ERR';
  xml?: string;
  /** Intentos consumidos (1 = fue a la primera) */
  attempts: number;
  error?: string;
  /** Pistas de quién respondió, para cuando el error no cuadra */
  server?: string;
  bodySnippet?: string;
}

export interface FetchOptions {
  /** Intentos totales por canal, incluido el primero */
  retries?: number;
  /** Espera base en ms; crece exponencialmente con jitter */
  backoffMs?: number;
  timeoutMs?: number;
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Un 404 entra aquí a propósito: YouTube lo usa para throttling. */
function isRetryable(status: number): boolean {
  return status === 404 || status === 403 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export async function fetchFeed(channelId: string, opts: FetchOptions = {}): Promise<FeedResponse> {
  const retries = opts.retries ?? 4;
  const backoffMs = opts.backoffMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let last: FeedResponse = { ok: false, status: 'ERR', attempts: 0 };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(feedUrl(channelId), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': UA,
          accept: 'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
          // Evita que nos sirvan una respuesta cacheada por un proxy intermedio.
          'cache-control': 'no-cache',
        },
      });

      if (res.ok) {
        return { ok: true, status: res.status, xml: await res.text(), attempts: attempt };
      }

      const body = await res.text().catch(() => '');
      last = {
        ok: false,
        status: res.status,
        attempts: attempt,
        server: res.headers.get('server') ?? undefined,
        bodySnippet: body.slice(0, 160).replace(/\s+/g, ' ').trim() || undefined,
      };

      if (!isRetryable(res.status) || attempt === retries) return last;
    } catch (err) {
      last = { ok: false, status: 'ERR', attempts: attempt, error: (err as Error).message };
      if (attempt === retries) return last;
    }

    // Backoff exponencial con jitter: separa las peticiones que YouTube
    // ha visto llegar juntas.
    const wait = backoffMs * 2 ** (attempt - 1) + Math.random() * backoffMs;
    await sleep(wait);
  }

  return last;
}

/** Mensaje legible, honesto sobre lo que un 404 significa de verdad. */
export function describeFailure(r: FeedResponse): string {
  if (r.status === 'ERR') return `${r.error} (${r.attempts} intentos)`;

  const extra = [r.server && `server=${r.server}`, r.bodySnippet && `body="${r.bodySnippet}"`]
    .filter(Boolean)
    .join(' ');
  const tail = extra ? ` · ${extra}` : '';

  if (r.status === 404) {
    return `HTTP 404 tras ${r.attempts} intentos — canal borrado o YouTube limitando el ritmo${tail}`;
  }
  if (r.status === 403 || r.status === 429) {
    return `HTTP ${r.status} tras ${r.attempts} intentos — YouTube está limitando las peticiones${tail}`;
  }
  return `HTTP ${r.status} tras ${r.attempts} intentos${tail}`;
}

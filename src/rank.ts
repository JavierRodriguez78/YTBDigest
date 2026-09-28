import type { Video } from './types.js';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const cache = new Map<string, RegExp>();

/**
 * Coincidencia por palabra completa: evita que "ia" case dentro de "familia"
 * o "nas" dentro de "finanzas". Las keywords multipalabra funcionan igual.
 */
function matcher(keyword: string): RegExp {
  const k = normalize(keyword);
  let re = cache.get(k);
  if (!re) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
    cache.set(k, re);
  }
  return re;
}

export function isBlocked(video: Video, blockKeywords: readonly string[]): boolean {
  const hay = normalize(`${video.title} ${video.description}`);
  return blockKeywords.some((k) => k && matcher(k).test(hay));
}

/**
 * Puntuación:
 *  - +3 por keyword de interés en el título, +1 si solo aparece en la descripción
 *  - +2 base si viene de una suscripción (ya lo has elegido tú)
 *  - bonus por frescura (0..2) para que lo de esta mañana suba sobre lo de ayer
 */
export function scoreVideo(video: Video, boostKeywords: readonly string[], now: Date): Video {
  const title = normalize(video.title);
  const desc = normalize(video.description);
  const reasons = [...video.reasons];
  let score = video.source === 'subscription' ? 2 : 0;

  for (const raw of boostKeywords) {
    if (!raw.trim()) continue;
    const re = matcher(raw);
    if (re.test(title)) {
      score += 3;
      reasons.push(raw);
    } else if (re.test(desc)) {
      score += 1;
    }
  }

  const ageHours = (now.getTime() - video.publishedAt.getTime()) / 3_600_000;
  score += Math.max(0, 2 - ageHours / 12);

  return { ...video, score: Math.round(score * 100) / 100, reasons: [...new Set(reasons)] };
}

export function dedupe(videos: Video[]): Video[] {
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const v of videos) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

import type { Video } from '../types.js';

interface SearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
  };
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Busca vídeos recientes por tema. Coste: 100 unidades de cuota por llamada
 * (10.000/día por defecto), así que mantén INTERESTS en una lista corta.
 */
export async function discoverByInterest(
  interest: string,
  since: Date,
  apiKey: string,
  maxResults: number,
): Promise<Video[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: interest,
    type: 'video',
    order: 'relevance',
    publishedAfter: since.toISOString(),
    relevanceLanguage: 'es',
    regionCode: 'ES',
    maxResults: String(Math.min(50, maxResults)),
    key: apiKey,
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`search.list "${interest}": HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { items?: SearchItem[] };
  const videos: Video[] = [];

  for (const item of data.items ?? []) {
    const id = item.id?.videoId;
    const sn = item.snippet;
    if (!id || !sn?.publishedAt) continue;
    const publishedAt = new Date(sn.publishedAt);
    if (Number.isNaN(publishedAt.getTime())) continue;

    videos.push({
      id,
      title: decode(sn.title ?? ''),
      description: decode(sn.description ?? ''),
      channelId: sn.channelId ?? '',
      channelTitle: sn.channelTitle ?? '',
      publishedAt,
      url: `https://www.youtube.com/watch?v=${id}`,
      source: 'discovery',
      topic: interest,
      score: 0,
      reasons: [`tema: ${interest}`],
    });
  }

  return videos;
}

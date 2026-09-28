import { XMLParser } from 'fast-xml-parser';
import type { Subscription, Video } from '../types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

interface RssEntry {
  'yt:videoId'?: string;
  'yt:channelId'?: string;
  title?: string;
  published?: string;
  author?: { name?: string };
  'media:group'?: { 'media:description'?: string | number };
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

async function fetchChannelFeed(sub: Subscription, since: Date, signal: AbortSignal): Promise<Video[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${sub.channelId}`;
  const res = await fetch(url, { signal, headers: { 'user-agent': 'yt-digest/1.0' } });
  if (!res.ok) throw new Error(`RSS ${sub.channelId}: HTTP ${res.status}`);

  const xml = await res.text();
  const doc = parser.parse(xml) as { feed?: { entry?: RssEntry | RssEntry[] } };
  const entries = asArray(doc.feed?.entry);

  const videos: Video[] = [];
  for (const e of entries) {
    const id = e['yt:videoId'];
    const published = e.published ? new Date(e.published) : undefined;
    if (!id || !published || Number.isNaN(published.getTime())) continue;
    if (published < since) continue;

    videos.push({
      id,
      title: String(e.title ?? '').trim(),
      description: String(e['media:group']?.['media:description'] ?? '').trim(),
      channelId: e['yt:channelId'] ?? sub.channelId,
      channelTitle: e.author?.name ?? sub.title,
      publishedAt: published,
      url: `https://www.youtube.com/watch?v=${id}`,
      source: 'subscription',
      score: 0,
      reasons: [],
    });
  }
  return videos;
}

/** Descarga en paralelo (pool acotado) los feeds de todas las suscripciones. */
export async function fetchSubscriptionVideos(
  subs: Subscription[],
  since: Date,
  concurrency: number,
): Promise<{ videos: Video[]; errors: string[] }> {
  const videos: Video[] = [];
  const errors: string[] = [];
  const queue = [...subs];

  const worker = async () => {
    for (;;) {
      const sub = queue.shift();
      if (!sub) return;
      const ac = AbortSignal.timeout(15_000);
      try {
        videos.push(...(await fetchChannelFeed(sub, since, ac)));
      } catch (err) {
        errors.push(`${sub.title}: ${(err as Error).message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { videos, errors };
}

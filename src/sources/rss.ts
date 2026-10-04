import { XMLParser } from 'fast-xml-parser';
import type { Subscription, Video } from '../types.js';
import { describeFailure, fetchFeed, type FeedResponse } from './fetch-feed.js';

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

function parseFeed(xml: string, sub: Subscription, since: Date): Video[] {
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

export interface SubscriptionFetchResult {
  videos: Video[];
  errors: string[];
  /** Canales que respondieron bien; si es 0 el problema es de red, no de los IDs */
  okCount: number;
  /** Reintentos consumidos en total, para ver si YouTube está apretando */
  retriesUsed: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga los feeds con un pool acotado y un pequeño escalonado entre
 * peticiones: una ráfaga simultánea es justo lo que YouTube castiga.
 */
export async function fetchSubscriptionVideos(
  subs: Subscription[],
  since: Date,
  concurrency: number,
  staggerMs = 150,
  retries = 4,
): Promise<SubscriptionFetchResult> {
  const videos: Video[] = [];
  let okCount = 0;
  let retriesUsed = 0;

  /** Canales pendientes de una segunda oportunidad */
  const failures: Array<{ sub: Subscription; res: FeedResponse }> = [];

  const take = (sub: Subscription, res: FeedResponse): boolean => {
    retriesUsed += res.attempts - 1;
    if (!res.ok || !res.xml) return false;
    okCount++;
    videos.push(...parseFeed(res.xml, sub, since));
    return true;
  };

  // --- Primera pasada: pool acotado con escalonado ---
  const queue = [...subs];
  const worker = async (slot: number) => {
    await sleep(slot * staggerMs);
    for (;;) {
      const sub = queue.shift();
      if (!sub) return;
      try {
        const res = await fetchFeed(sub.channelId, { retries });
        if (!take(sub, res)) failures.push({ sub, res });
      } catch (err) {
        failures.push({
          sub,
          res: { ok: false, status: 'ERR', attempts: 1, error: (err as Error).message },
        });
      }
      await sleep(staggerMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, (_, i) => worker(i)));

  // --- Segunda pasada: los fallidos, en serie y sin prisa ---
  // Si YouTube estaba limitando el ritmo, a estas alturas ya ha pasado el pico.
  const errors: string[] = [];
  if (failures.length > 0) {
    await sleep(5_000);
    for (const { sub, res: firstRes } of failures) {
      try {
        const res = await fetchFeed(sub.channelId, { retries: 2, backoffMs: 3000 });
        if (take(sub, res)) continue;
        errors.push(`${sub.title} [${sub.channelId}]: ${describeFailure(res)}`);
      } catch (err) {
        errors.push(`${sub.title} [${sub.channelId}]: ${(err as Error).message}`);
        void firstRes;
      }
      await sleep(1_000);
    }
  }

  return { videos, errors, okCount, retriesUsed };
}

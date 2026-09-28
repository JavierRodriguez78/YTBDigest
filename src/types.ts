export type VideoSource = 'subscription' | 'discovery';

export interface Video {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: Date;
  url: string;
  source: VideoSource;
  /** Tema de INTERESTS que lo encontró (solo en descubrimiento) */
  topic?: string;
  /** Puntuación heurística 0..n calculada en rank.ts */
  score: number;
  /** Motivos del scoring (keywords que han casado, etc.) */
  reasons: string[];
  /** Resumen/valoración opcional generada por LLM */
  aiNote?: string;
}

export interface Subscription {
  channelId: string;
  title: string;
}

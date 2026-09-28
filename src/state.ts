import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

interface StateFile {
  lastRun: string | null;
  seen: Record<string, string>; // videoId -> ISO de cuando se notificó
}

const RETENTION_DAYS = 30;

export class State {
  private data: StateFile = { lastRun: null, seen: {} };

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StateFile>;
      this.data = { lastRun: parsed.lastRun ?? null, seen: parsed.seen ?? {} };
    } catch {
      // Primera ejecución: estado vacío.
    }
  }

  has(id: string): boolean {
    return id in this.data.seen;
  }

  markSeen(ids: string[], at = new Date()): void {
    for (const id of ids) this.data.seen[id] = at.toISOString();
    this.data.lastRun = at.toISOString();
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    for (const [id, iso] of Object.entries(this.data.seen)) {
      if (new Date(iso).getTime() < cutoff) delete this.data.seen[id];
    }
  }

  async save(): Promise<void> {
    this.prune();
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

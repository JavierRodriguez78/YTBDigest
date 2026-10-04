import { readFile } from 'node:fs/promises';
import type { Subscription } from './types.js';

const CHANNEL_ID = /^UC[\w-]{22}$/;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Acepta:
 *  - CSV de Google Takeout ("Channel Id,Channel Url,Channel Title" o sus variantes en es)
 *  - TXT con un channel ID (UC...) o una URL de canal por línea
 * La cabecera no importa: se detecta el campo que parece un channel ID.
 */
export async function loadSubscriptions(path: string): Promise<Subscription[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(
      `No se pudo leer ${path}. Exporta tus suscripciones con Google Takeout (YouTube > suscripciones) o crea un TXT con un channel ID por línea.`,
    );
  }

  const subs = new Map<string, Subscription>();
  const skipped: Array<{ line: number; text: string }> = [];
  let lineNo = 0;

  for (const line of raw.split(/\r?\n/)) {
    lineNo++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const fields = trimmed.includes(',') ? splitCsvLine(trimmed) : [trimmed];

    let channelId: string | undefined;
    for (const f of fields) {
      if (CHANNEL_ID.test(f)) {
        channelId = f;
        break;
      }
      const m = f.match(/channel\/(UC[\w-]{22})/);
      if (m) {
        channelId = m[1];
        break;
      }
    }
    if (!channelId) {
      // La cabecera del CSV de Takeout cae aquí y es normal; cualquier otra
      // línea descartada es un canal que creías tener y no tienes.
      if (!/channel\s*id/i.test(trimmed)) skipped.push({ line: lineNo, text: trimmed.slice(0, 70) });
      continue;
    }

    const title = fields.find((f) => f !== channelId && !f.startsWith('http') && f.length > 0) ?? channelId;
    subs.set(channelId, { channelId, title });
  }

  if (skipped.length > 0) {
    console.warn(
      `[subs] ${skipped.length} línea(s) descartadas por no contener un channel ID (UC + 22 caracteres):`,
    );
    for (const s of skipped.slice(0, 10)) console.warn(`[subs]   línea ${s.line}: ${s.text}`);
    if (skipped.length > 10) console.warn(`[subs]   … y ${skipped.length - 10} más`);
    console.warn('[subs] Un handle (@canal) o una URL /c/nombre no sirven: usa npm run resolve-handles');
  }

  if (subs.size === 0) {
    throw new Error(`No se encontró ningún channel ID válido en ${path}.`);
  }

  return [...subs.values()];
}

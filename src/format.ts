import type { Video } from './types.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hoursAgo(v: Video, now: Date): string {
  const h = Math.round((now.getTime() - v.publishedAt.getTime()) / 3_600_000);
  return h < 1 ? 'hace minutos' : `hace ${h}h`;
}

function renderItem(v: Video, now: Date): string {
  const head = `<a href="${v.url}">${escapeHtml(v.title)}</a>`;
  const topic = v.topic ? ` · ${escapeHtml(v.topic)}` : '';
  const meta = `${escapeHtml(v.channelTitle)} · ${hoursAgo(v, now)}${topic}`;
  const note = v.aiNote ? `\n  <i>${escapeHtml(v.aiNote)}</i>` : '';
  return `• ${head}\n  ${meta}${note}`;
}

export function renderDigest(
  subs: Video[],
  discovery: Video[],
  now: Date,
  warning?: string,
): string {
  const fecha = now.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const lines: string[] = [`<b>YouTube · ${escapeHtml(fecha)}</b>`];

  if (warning) lines.push('', `⚠️ <b>${escapeHtml(warning)}</b>`);

  lines.push('', `<b>De tus suscripciones (${subs.length})</b>`);
  lines.push(
    subs.length
      ? subs.map((v) => renderItem(v, now)).join('\n')
      : warning
        ? '— No se pudo consultar.'
        : '— Sin novedades.',
  );

  if (discovery.length) {
    lines.push('', `<b>Te puede interesar (${discovery.length})</b>`);
    lines.push(discovery.map((v) => renderItem(v, now)).join('\n'));
  }

  return lines.join('\n');
}

/** Versión plana para stdout/logs. */
export function toPlainText(html: string): string {
  return html
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '$2 — $1')
    .replace(/<\/?(b|i)>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

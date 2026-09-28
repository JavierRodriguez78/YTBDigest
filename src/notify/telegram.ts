const MAX_LEN = 3800;

function chunk(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > MAX_LEN) {
      parts.push(current);
      current = '';
    }
    current += `${line}\n`;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  for (const part of chunk(text)) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

import type { Video } from './types.js';

interface AiVerdict {
  id: string;
  keep: boolean;
  note: string;
}

const SYSTEM = `Eres un filtro de relevancia para un ingeniero de software senior (manager técnico)
que además repara electrónica y monta su propio homelab.
Le interesan:
- IA aplicada, LLMs y agentes; arquitectura de software; backend Node/TypeScript; DevOps.
- Homelab y self-hosting: Proxmox, Docker, Kubernetes, NAS, ZFS, redes domésticas, VLANs,
  firewalls, montaje de racks caseros, SAI, cableado.
- Electrónica y reparación: consolas (retro y actuales), móviles y tablets, soldadura y
  microsoldadura, diagnóstico con multímetro u osciloscopio, recap, fuentes de alimentación,
  sustitución de pantallas y baterías, herramientas de taller.
NO le interesan: contenido de nivel principiante absoluto, clickbait, noticias sin sustancia,
reviews de producto genéricas sin desmontaje ni análisis técnico, criptomonedas especulativas,
vídeos que solo enseñan un montaje sin explicar el porqué.
Valora tanto lo teórico como lo práctico: un desmontaje o una reparación real bien explicada
es tan válida como una charla de arquitectura.
Responde SOLO con un array JSON, sin markdown ni texto adicional.
Cada elemento: {"id": string, "keep": boolean, "note": string}
"note": una frase corta en español explicando qué aporta el vídeo. Máximo 15 palabras.`;

/**
 * Filtra y anota la lista con un modelo de Anthropic. Si algo falla,
 * devuelve la lista original intacta: el digest nunca debe romperse por esto.
 */
export async function annotateWithClaude(
  videos: Video[],
  apiKey: string,
  model: string,
): Promise<Video[]> {
  if (!apiKey || videos.length === 0) return videos;

  const payload = videos.map((v) => ({
    id: v.id,
    title: v.title,
    channel: v.channelTitle,
    description: v.description.slice(0, 300),
  }));

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    const verdicts = JSON.parse(text) as AiVerdict[];
    const byId = new Map(verdicts.map((v) => [v.id, v]));

    return videos
      .filter((v) => byId.get(v.id)?.keep !== false)
      .map((v) => {
        const note = byId.get(v.id)?.note;
        return note ? { ...v, aiNote: note } : v;
      });
  } catch (err) {
    console.warn(`[ai] valoración omitida: ${(err as Error).message}`);
    return videos;
  }
}

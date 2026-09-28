const ES_STOPWORDS = new Set([
  'el','la','los','las','un','una','unos','unas','de','del','al','y','o','pero','porque','como',
  'que','qué','con','sin','para','por','en','es','son','está','están','este','esta','estos','estas',
  'ya','muy','más','menos','hacer','cómo','mejor','nuevo','nueva','todo','toda','tu','tus','mi','mis',
  'vamos','aquí','así','también','desde','hasta','sobre','entre','cuando','donde','tiene','puedes',
]);

const EN_STOPWORDS = new Set([
  'the','and','you','your','this','that','with','for','from','have','has','what','how','why','best',
  'new','build','building','using','guide','tutorial','into','about','when','where','which','they',
  'will','can','make','making','everything','here','there','more','than','just','like','now',
]);

const ES_CHARS = /[ñáéíóúü¿¡]/i;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^a-záéíóúüñ¿¡']+/i)
    .filter((t) => t.length > 1);
}

export interface LanguageGuess {
  isSpanish: boolean;
  confidence: number;
}

/**
 * Heurística ligera: no necesita dependencias ni llamadas extra a la API.
 * Pesa stopwords ES vs EN sobre título + descripción y bonifica caracteres
 * exclusivos del castellano.
 */
export function guessSpanish(title: string, description = ''): LanguageGuess {
  const text = `${title}\n${description.slice(0, 600)}`;
  const words = tokens(text);
  if (words.length === 0) return { isSpanish: false, confidence: 0 };

  let es = 0;
  let en = 0;
  for (const w of words) {
    if (ES_STOPWORDS.has(w)) es++;
    if (EN_STOPWORDS.has(w)) en++;
  }

  if (ES_CHARS.test(text)) es += 2;

  const total = es + en;
  if (total === 0) {
    // Sin señal: títulos muy cortos o puramente técnicos.
    return { isSpanish: ES_CHARS.test(text), confidence: 0.2 };
  }

  const confidence = es / total;
  return { isSpanish: es > en, confidence };
}

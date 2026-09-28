function list(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(raw.toLowerCase());
}

export const config = {
  /** Ventana de novedades en horas */
  lookbackHours: num('LOOKBACK_HOURS', 26),

  /** Fichero con tus suscripciones (CSV de Takeout o TXT de channel IDs) */
  subscriptionsFile: process.env.SUBSCRIPTIONS_FILE ?? './data/subscriptions.csv',

  /** Fichero de estado (vídeos ya notificados) */
  stateFile: process.env.STATE_FILE ?? './data/state.json',

  /** Solo vídeos detectados como español */
  spanishOnly: bool('SPANISH_ONLY', true),

  /** Si true, los vídeos de tus suscripciones pasan aunque no sean español */
  keepAllSubscriptions: bool('KEEP_ALL_SUBSCRIPTIONS', false),

  /** Temas para la parte de descubrimiento (search.list). Cada uno = 100 unidades de cuota/día */
  interests: list('INTERESTS', [
    'inteligencia artificial',
    'agentes IA LLM',
    'homelab casero',
    'proxmox',
    'self-hosting docker',
    'montar rack servidores casa',
    'redes domesticas vlan pfsense',
    'NAS almacenamiento casero',
    'reparacion de consolas',
    'reparacion de moviles',
    'reparacion electronica soldadura',
    'microsoldadura placa base',
    'restauracion consolas retro',
    'electronica diy',
  ]),

  /** Palabras que suben la puntuación de cualquier vídeo */
  boostKeywords: list('BOOST_KEYWORDS', [
    // IA / software
    'ia','ai','llm','agente','agentes','mcp','claude','rag',
    'nestjs','typescript','nodejs','arquitectura','devops','kubernetes','terraform',
    // homelab / infra
    'homelab','proxmox','docker','self-hosted','selfhosted','nas','rack','servidor',
    'vlan','pfsense','opnsense','truenas','unraid','zfs','ups','switch','poe',
    // electrónica / reparación
    'reparacion','reparar','averia','soldadura','microsoldadura','estacion de soldar',
    'multimetro','osciloscopio','placa base','condensador','recap','retro',
    'consola','mando','pantalla','bateria','flex','psu','fuente de alimentacion',
  ]),

  /** Palabras que descartan el vídeo directamente */
  blockKeywords: list('BLOCK_KEYWORDS', ['shorts', 'sorteo', 'unboxing patrocinado']),

  /** API key de YouTube Data API v3 (solo necesaria para descubrimiento) */
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',

  /** Máximo de resultados por tema en descubrimiento */
  discoveryPerInterest: num('DISCOVERY_PER_INTEREST', 8),

  /** Tope de vídeos en el digest final */
  maxSubscriptionItems: num('MAX_SUBSCRIPTION_ITEMS', 25),
  maxDiscoveryItems: num('MAX_DISCOVERY_ITEMS', 14),

  /** Ranking/resumen opcional con Claude */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',

  /** Telegram (opcional). Sin esto, el digest sale por stdout */
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',

  /** Ejecución programada interna: "08:00". Vacío = ejecuta una vez y sale */
  dailyAt: process.env.DAILY_AT ?? '',

  /** Con DAILY_AT activo, hace una pasada nada más arrancar el contenedor */
  runOnStart: bool('RUN_ON_START', true),

  /** No marca como vistos ni envía: solo imprime */
  dryRun: bool('DRY_RUN', false),

  concurrency: num('CONCURRENCY', 8),
} as const;

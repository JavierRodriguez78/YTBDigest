# yt-digest

Digest diario de YouTube: novedades de tus suscripciones (en español) + vídeos de descubrimiento sobre tus temas (IA y software, homelab y redes, electrónica y reparación).

Node 22 + TypeScript, una sola dependencia de runtime (`fast-xml-parser`). Pensado para correr en contenedor.

## Cómo funciona

1. **Suscripciones** → lee el RSS público de cada canal (`/feeds/videos.xml?channel_id=UC...`). Sin OAuth, sin cuota de API, sin límite de canales.
2. **Descubrimiento** → `search.list` de YouTube Data API v3 con `relevanceLanguage=es`, filtrando canales que ya sigues.
3. **Filtrado** → descarta ya vistos (estado en `data/state.json`), keywords bloqueadas y contenido no español (heurística de stopwords ES/EN + caracteres propios del castellano).
4. **Ranking** → puntuación por keywords en título/descripción, bonus por suscripción y por frescura.
5. **Valoración opcional** → una pasada con Claude sobre los candidatos de descubrimiento que descarta ruido y añade una frase de por qué merece la pena. Si falla, el digest sale igual.
6. **Entrega** → Telegram si está configurado; si no, stdout.

## Puesta en marcha

### 1. Obtener tus suscripciones

Google Takeout → *YouTube y YouTube Music* → solo **suscripciones** → exportar. Te baja un `suscripciones.csv`. Cópialo a `data/subscriptions.csv`.

También vale un `.txt` con un channel ID (`UC...`) o una URL de canal por línea. Se acepta cualquier cabecera; el parser busca el campo que tiene pinta de channel ID.

> Nota: YouTube no expone tu feed de suscripciones vía API pública sin OAuth, y Takeout es un fichero que exportas una vez. Si añades canales a menudo, reexporta cada pocos meses o mantén el TXT a mano.

### 2. API key de YouTube (opcional, solo descubrimiento)

Google Cloud Console → habilitar *YouTube Data API v3* → crear credencial **API key**. Es una key pública de solo lectura, no necesita OAuth.

Cuota: 10.000 unidades/día, y cada búsqueda cuesta 100. Con los 14 temas por defecto gastas 1.400/día. Margen de sobra para añadir más.

### 3. Configurar y arrancar

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build     # servicio "digest": residente, una pasada al día
docker compose logs -f
```

El servicio `digest` duerme hasta `DAILY_AT` (08:00 por defecto), ejecuta y vuelve a dormir. Con `RUN_ON_START=true` hace además una pasada nada más levantar el contenedor, así que no tienes que esperar a mañana para ver si funciona.

### Probar antes de enviar nada

```bash
docker compose run --rm dry      # ventana de 7 días, imprime y no marca nada
```

### Una ejecución suelta

```bash
docker compose run --rm once
```

### Programarlo desde el host en vez del proceso residente

Si prefieres que no haya un contenedor durmiendo, usa `once` con systemd (recomendado: `Persistent=true` recupera la ejecución si la máquina estaba apagada):

```bash
sudo cp deploy/yt-digest.* /etc/systemd/system/
sudo $EDITOR /etc/systemd/system/yt-digest.service   # ajusta User= y WorkingDirectory=
sudo systemctl daemon-reload
sudo systemctl enable --now yt-digest.timer
systemctl list-timers yt-digest.timer
```

O con cron:

```cron
0 8 * * * cd /opt/yt-digest && docker compose run --rm once >> /var/log/yt-digest.log 2>&1
```

### Ejecución local sin Docker

```bash
npm install && npm run build
npm run dry-run     # imprime sin enviar ni marcar como visto
npm run once        # una pasada real
npm start           # residente, si DAILY_AT está puesto en .env
```

## Telegram

Habla con `@BotFather` → `/newbot` → te da el token. Escríbele algo a tu bot y saca el chat ID con:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

## Afinado

- `LOOKBACK_HOURS=26` da solape por si una ejecución falla; el estado evita duplicados.
- `BOOST_KEYWORDS` usa coincidencia por palabra completa (`ia` no casa dentro de `familia`).
- `KEEP_ALL_SUBSCRIPTIONS=true` si prefieres ver todo lo de tus canales aunque publiquen en inglés.
- Si el filtro de idioma se pasa de estricto, baja el peso mirando `src/filters/language.ts`: es una heurística deliberadamente simple, sin dependencias.

## Limitaciones conocidas

- El RSS de YouTube devuelve solo los ~15 últimos vídeos por canal. Con ejecución diaria sobra; si paras el servicio una semana, perderás lo de canales muy prolíficos.
- La detección de idioma es heurística. Un título técnico corto sin stopwords puede colarse o caerse. La alternativa fiable (`videos.list` con `defaultAudioLanguage`) cuesta cuota extra y muchos canales no lo rellenan.
- `search.list` ordena por relevancia dentro de la ventana temporal, no es exhaustivo.

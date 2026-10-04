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

**Verifica el fichero antes de confiar en él:**

```bash
docker compose run --rm check       # o: npm run check-subs
```

Comprueba cada ID contra YouTube y te dice el nombre real de cada canal. Un ID puede tener la forma correcta (`UC` + 22 caracteres) y no existir: eso da 404 y el canal se ignora en silencio. El verificador los separa de los bloqueos (403/429), que no son culpa del ID.

**Si solo tienes handles** (`@midudev`) en vez de IDs:

```bash
docker compose run --rm resolve @midudev @DotCSV > data/subscriptions.csv
# o desde un fichero de handles, uno por línea:
npm run resolve-handles -- --file data/handles.txt > data/subscriptions.csv
```

Los resuelve leyéndolos del propio YouTube (API si hay key, HTML si no), y nunca inventa uno: si no lo encuentra, lo reporta como fallo y no lo escribe.

> Si `check` devuelve 404 en todos los canales, lee antes la sección **El 404 de YouTube no significa lo que parece**: lo más probable es un límite de ritmo, no que los IDs estén mal.

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

## Diagnóstico

### El 404 de YouTube no significa lo que parece

El endpoint RSS de YouTube devuelve **404, no 429**, cuando decide limitar una ráfaga de peticiones desde una misma IP. Un 404 por tanto **no prueba que el canal no exista**. El síntoma clásico: fallan los 20 canales de golpe, en menos de 200 ms, y los mismos IDs funcionan perfectamente diez minutos después.

Por eso el cliente HTTP trata el 404 como reintentable:

1. Hasta `FEED_RETRIES` intentos por canal, con backoff exponencial y jitter.
2. Escalonado entre peticiones (`STAGGER_MS`) y concurrencia baja (`CONCURRENCY=4`), para no formar la ráfaga que lo provoca.
3. Una segunda pasada al final, en serie y sin prisa, solo con los que fallaron.

Un canal se da por caído solo si falla en las dos pasadas. Los canales sanos siguen costando una sola petición.

El log te dice cuánto está apretando YouTube: `16 reintentos consumidos`. Si ese número es alto todos los días, baja `CONCURRENCY` o sube `STAGGER_MS`.

### Tabla de síntomas

| Síntoma en el log | Causa | Qué hacer |
|---|---|---|
| Fallan TODOS, en milisegundos, con 404 | Ráfaga limitada por YouTube, o red caída | Los reintentos deberían absorberlo. Si persiste, `check` y bajar `CONCURRENCY` |
| `HTTP 404 tras N intentos` en uno o dos canales | Ese canal sí está borrado | Quitarlo del fichero |
| `N reintentos consumidos` alto cada día | Vas demasiado rápido para tu IP | Subir `STAGGER_MS`, bajar `CONCURRENCY` |
| `[subs] N línea(s) descartadas` | Handles o URLs `/c/` en el fichero | `resolve` para convertirlos |
| `N suscripciones cargadas` menor de lo esperado | Lo mismo de arriba | Mirar el aviso `[subs]` justo encima |
| `0 vídeos nuevos` sin errores y con `feeds OK` | Nadie ha publicado en la ventana | Normal. Probar `LOOKBACK_HOURS=168` |

Cuando fallan todos los feeds, el aviso viaja **dentro del mensaje de Telegram**, no solo en el log: si no, una avería de red se lee como "hoy nadie publicó nada" y puede pasar semanas sin que te enteres.

## Limitaciones conocidas

- El RSS de YouTube devuelve solo los ~15 últimos vídeos por canal. Con ejecución diaria sobra; si paras el servicio una semana, perderás lo de canales muy prolíficos.
- La detección de idioma es heurística. Un título técnico corto sin stopwords puede colarse o caerse. La alternativa fiable (`videos.list` con `defaultAudioLanguage`) cuesta cuota extra y muchos canales no lo rellenan.
- `search.list` ordena por relevancia dentro de la ventana temporal, no es exhaustivo.

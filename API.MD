# TipMiner API — Bac Bo (Evolution) · Documentación verificada

Base URL: `https://api.core.public.tipminer.com`

API pública **sin autenticación** (no requiere token, cookie ni `Authorization`). La primera versión de este documento fue **verificada el 2026-08-01**. El **2026-08-06 se re-verificó todo contra la API real** (3 llamadas a `/history` espaciadas en el tiempo, captura de `/live` en vivo, y consultas a `/v1/casinos` y `/v1/games/status`) para el diseño del esquema de persistencia (ver `DATABASE.md`) — se encontraron **discrepancias reales frente a lo documentado el 2026-08-01**, marcadas explícitamente abajo como `[ACTUALIZADO 2026-08-06]`. Se deja el ejemplo original también, para que quede registro de que el esquema efectivamente cambió en 5 días — es la prueba de que esta API "puede cambiar sin aviso" (§7.9).

---

## 1. Los IDs de tu juego (Bac Bo — Evolution)

| Elemento            | UUID                                                    |
| ------------------- | ------------------------------------------------------- |
| Casino              | Evolution — `aa94b13a-229a-4e48-8f40-4d8f30b76c09`      |
| Juego               | Bac Bo — `816531bb-ae4d-4388-86dd-86f037aa586b`         |
| **Provider (mesa)** | **`cc71e81d-8b56-4868-91c7-7224be543dce`**              |
| Provider fallback   | Bac Bo ao Vivo — `daed14c3-2a22-47b3-83c6-2c3a50c2ae69` |

Regla de oro: **en las rutas `/rounds/...` siempre va el `provider`** (el de la mesa). Si pones el uuid del juego (`816531bb-...`), la API responde `[]` vacío sin dar error — es el error más típico de esta integración.

---

## 2. Endpoints de Bac Bo (los únicos que necesitas)

| Método | Ruta                                   | Uso                                             |
| ------ | -------------------------------------- | ----------------------------------------------- |
| GET    | `/v1/casinos`                          | Descubrir/validar IDs de Bac Bo (caché 24 h)    |
| GET    | `/v1/games/status`                     | Salud de tu mesa (LIVE/pausada) — caché 10-30 s |
| GET    | `/v1/bac-bo/rounds/{provider}/history` | Historial de rondas                             |
| GET    | `/v1/bac-bo/rounds/{provider}/live`    | Streaming SSE en tiempo real                    |

> Nota: `range-per-hour` NO existe para Bac Bo (devuelve 404, verificado). Es solo de juegos Crash/Aviator.

---

## 3. GET /v1/casinos

Sirve para descubrir o re-validar los IDs de Bac Bo sin hardcodearlos.

- **Parámetros**: ninguno. **Caché recomendada**: 24 h.
- El juego Bac Bo está dentro del casino Evolution — el objeto de juego individual se ve así:

```json
{
  "uuid": "816531bb-ae4d-4388-86dd-86f037aa586b",
  "name": "Bac Bo",
  "type": "BAC_BO",
  "subtype": "BAC_BO",
  "casino": "aa94b13a-229a-4e48-8f40-4d8f30b76c09",
  "provider": "cc71e81d-8b56-4868-91c7-7224be543dce",
  "timestamps": { "insert": "…", "update": "…", "disable": null },
  "description": null,
  "cover": "…"
}
```

Campos clave: `uuid` = juego (no se usa en rounds), **`provider` = mesa (el que sí se usa)**, `type = "BAC_BO"`, `timestamps.disable` = `null` (si tiene fecha, el juego está deshabilitado).

### `[ACTUALIZADO 2026-08-06]` Forma real de la respuesta completa

El objeto de arriba es el **juego individual**, pero la respuesta real de `/v1/casinos` es un **array de casinos** (26 elementos verificados el 2026-08-06), cada uno con un array anidado `games[]` — el objeto de juego mostrado arriba vive dentro de ese array, no suelto:

```json
[
  {
    "uuid": "aa94b13a-229a-4e48-8f40-4d8f30b76c09",
    "name": "Evolution",
    "logo": "…",
    "legacyId": "…",
    "metadata": { "carousel_order": 19 },
    "referral": { "link": "…" },
    "timestamps": { "insert": "…", "update": "…", "disable": null },
    "games": [
      { "uuid": "816531bb-ae4d-4388-86dd-86f037aa586b", "name": "Bac Bo", "type": "BAC_BO", "provider": "cc71e81d-8b56-4868-91c7-7224be543dce", "…": "…" }
    ]
  }
]
```

**Hallazgo no documentado antes**: el mismo `provider` (`cc71e81d-8b56-4868-91c7-7224be543dce`) aparece repetido dentro de `games[]` de **al menos 6 casinos distintos** (Jonbet, Betou, Evolution, Blaze, SorteNaBet, BetFusion — verificado 2026-08-06), cada uno con su propio `game.uuid` y su propio `casino.uuid`, pero el mismo `provider`. Esto confirma que `provider` identifica la **mesa/feed real de Evolution** (el proveedor B2B del juego) — muchas marcas de apuestas (white-label) simplemente insertan la misma mesa en su sitio. Para filtrar por Bac Bo/Evolution específicamente, hay que recorrer `games[]` de todos los casinos y filtrar por `provider`, no asumir que el juego vive en un único casino.

---

## 4. GET /v1/games/status

Estado en tiempo real de tu mesa. **Tu sensor de salud.**

```json
{
  "gameId": "cc71e81d-8b56-4868-91c7-7224be543dce",
  "status": "LIVE",
  "version": "218162",
  "lastRoundReceivedAt": "2026-08-01T21:10:39.377Z"
}
```

| Campo                 | Qué significa                                                     |
| --------------------- | ----------------------------------------------------------------- |
| `gameId`              | El `provider` de tu mesa                                          |
| `status`              | `LIVE` (emitiendo) / `OFFLINE`                                    |
| `version`             | Contador de rondas **monotónico creciente** — sube con cada ronda |
| `lastRoundReceivedAt` | Última ronda recibida por el servidor                             |

**Cómo usarlo con tu mesa Bac Bo:**

- ¿El SSE está mudo? Consulta `games/status`: si `lastRoundReceivedAt` tiene más de 5-10 min, la mesa está **pausada** (no es un error tuyo).
- Si `status` es `LIVE` pero `version` no crece → la API dejó de recibir datos del casino: **caída del lado de ellos**.
- Usa el provider fallback (`daed14c3-...`, Bac Bo ao Vivo) cuando la mesa principal esté pausada.

### `[ACTUALIZADO 2026-08-06]` Forma real de la respuesta y semántica de `version`

El ejemplo de arriba muestra el objeto de **un solo juego** ya filtrado, pero la respuesta real, verificada el 2026-08-06, es un **array con los 101 juegos** que Tipminer monitorea — no un objeto único para "tu mesa":

```json
[
  { "gameId": "b671a3b9-6731-4413-94c1-d111e878a785", "status": "LIVE", "version": "217387", "lastRoundReceivedAt": "…" },
  { "gameId": "cc71e81d-8b56-4868-91c7-7224be543dce", "status": "LIVE", "version": "228642", "lastRoundReceivedAt": "…" }
]
```

- **Los query params se ignoran** (probado `?gameId=`, `?provider=`, y sin parámetros → los 3 devuelven exactamente los mismos 13534 bytes): hay que pedir el array completo y filtrar client-side por `gameId === provider`, igual que ya se documenta para los filtros de `/history` (§5).
- **`version` es un contador por juego/mesa, no global a Tipminer**: en la misma respuesta, mesas distintas mostraban valores completamente distintos entre sí (`217387`, `55737`, `123417`, `228642`, ...) sin relación aparente. Esto responde la duda que dejaba abierta la sección 5: no sirve como "número de secuencia compartido entre mesas", solo tiene sentido comparado contra sí mismo, mesa por mesa.
- `version` viene como **string** en `/games/status` (`"228642"`), no como número — distinto de como se documentaba en `/history` (número). Otra inconsistencia de tipos a validar client-side si se llega a usar.

---

## 5. GET /v1/bac-bo/rounds/{provider}/history

**El endpoint principal.** Historial de rondas de la mesa Bac Bo de Evolution.

```
GET https://api.core.public.tipminer.com/v1/bac-bo/rounds/cc71e81d-8b56-4868-91c7-7224be543dce/history?timezone=America%2FSao_Paulo&limit=200
```

### Parámetros

| Parámetro         | Valor                                  | Notas                                               |
| ----------------- | -------------------------------------- | --------------------------------------------------- |
| `provider` (ruta) | `cc71e81d-8b56-4868-91c7-7224be543dce` | Obligatorio                                         |
| `timezone`        | `America/Sao_Paulo` (URL-encoded)      | No cambia timestamps; solo límites de fecha/hora    |
| `limit`           | `1` a `200`                            | **Máximo real: 200** (pedir más devuelve 200 igual) |

### Respuesta (verificada el 2026-08-01)

```json
[
  {
    "uuid": "019fbf2b-4ab7-72b9-bf19-5b949035a6e7",
    "type": "PLAYER",
    "result": 8,
    "instant": "2026-08-01T21:11:53.111Z",
    "version": 218162,
    "externalId": "18c7caab235a29f43eb440ff"
  }
]
```

### `[ACTUALIZADO 2026-08-06]` DISCREPANCIA: `version` y `externalId` ya no aparecen

Re-verificado con 3 llamadas reales espaciadas en el tiempo el 2026-08-06 (600+ filas inspeccionadas): **ningún registro trae `version` ni `externalId`** — ni uno solo. La respuesta real de hoy es:

```json
[
  {
    "uuid": "019fd520-86bf-76f1-8865-c142d6c9b72b",
    "type": "PLAYER",
    "result": 10,
    "instant": "2026-08-06T03:31:46.345Z"
  }
]
```

- Los 4 campos restantes (`uuid`, `type`, `result`, `instant`) se mantienen 100% estables y con el mismo formato.
- Confirmado además: inmutabilidad de rondas ya publicadas (0 cambios en ~198 filas repetidas entre 2 llamadas consecutivas), paginación FIFO exacta con `limit=200` (entran N rondas nuevas, salen N del extremo antiguo), cadencia real 30.9-82s (promedio ≈35.3s, consistente con lo ya documentado), y rango de `result` observado 4-12 (2 y 3 no aparecieron en la muestra, pero el rango teórico 2-12 sigue siendo válido).
- El `uuid` de esta muestra (`019fd5...`, 2026-08-06) vs. el de la muestra original (`019fbf...`, 2026-08-01) crece de forma consistente con el paso del tiempo — evidencia circunstancial (no prueba formal) de que es UUIDv7 (time-ordered).
- **Consecuencia práctica**: cualquier código o diseño de base de datos que dependa de `version`/`externalId` debe asumir que pueden estar ausentes en cualquier momento, no solo "a veces". Ver `DATABASE.md` para el esquema real de la tabla `jugadas`, diseñado teniendo esto en cuenta.
- El SSE (`/live`, §6) ya no tiene ninguna ventaja de campos sobre `/history` — hoy ambos entregan exactamente los mismos 4 campos.

### Los 3 valores posibles de `type` (verificados en la mesa real)

| `type`   | Significado | Resultados vistos      |
| -------- | ----------- | ---------------------- |
| `PLAYER` | Gana Player | 6, 7, 8, 9, 10, 11, 12 |
| `BANKER` | Gana Banker | 7, 8, 10               |
| `TIE`    | Empate      | 7, 7, 8, 10            |

`result` = puntos, suma de 2 dados (rango 2–12). En TIE ambos lados tienen la misma puntuación.

### Reglas de la respuesta

| Regla        | Detalle                                                            |
| ------------ | ------------------------------------------------------------------ |
| Orden        | **Más reciente primero** (la primera del array es la última ronda) |
| `instant`    | Siempre **UTC** (ISO 8601 con `Z`) — conviértelo tú a tu timezone  |
| `uuid`       | Único por ronda → úsalo para **deduplicar**                        |
| `version`    | Contador global del servidor (coincide con `games/status`)         |
| `externalId` | ID del proveedor externo (para correlacionar con el casino real)   |

### Cadencia de la mesa

Una ronda cada **~35 segundos** (medido en vivo). 200 rondas ≈ 2 horas de historial.

### Filtros que NO funcionan sin login

`types`, `numbers`, `date`, `hour`, `minute`, `timeIni`, `timeEnd`, `resultIni`, `resultEnd`, `results`, `subject`, `divisor`, etc. → todos se **ignoran** para peticiones anónimas (verificado: devuelven lo mismo que sin filtros). Solo responden con sesión iniciada en TipMiner. **Filtra client-side.**

---

## 6. GET /v1/bac-bo/rounds/{provider}/live — SSE (tiempo real)

Streaming Server-Sent Events con las rondas de tu mesa al instante. **Es la forma correcta de recibir datos en vivo: una conexión, sin polling.**

```
GET https://api.core.public.tipminer.com/v1/bac-bo/rounds/cc71e81d-8b56-4868-91c7-7224be543dce/live
```

### Formato del stream (captura real de la mesa Bac Bo)

```
id: 019fbf2b-4ab7-72b9-bf19-5b949035a6e7
data: {"uuid":"019fbf2b-4ab7-72b9-bf19-5b949035a6e7","type":"PLAYER","result":8,"instant":"2026-08-01T21:11:53.111Z"}

id: 019fbf2b-daad-7578-ac1c-a3ba28e104e9
data: {"uuid":"019fbf2b-daad-7578-ac1c-a3ba28e104e9","type":"PLAYER","result":12,"instant":"2026-08-01T21:12:29.990Z"}
```

- Cada evento: línea `id:` (uuid) + línea `data:` (JSON), separados por línea en blanco. Sin `event:` personalizado (es `message`).
- El `data` del SSE **NO incluye** `version` ni `externalId` (solo `uuid`, `type`, `result`, `instant`). `[ACTUALIZADO 2026-08-06]`: esto ya no es una diferencia con `/history` — hoy `/history` **tampoco** los incluye (ver §5). Re-verificado en vivo con una captura real de ~110s (2 eventos), formato idéntico al documentado, y con cruce confirmado: los `uuid` vistos en el SSE aparecieron como filas "nuevas" en la siguiente llamada a `/history` — mismo espacio de identificadores.
- Entre rondas pueden llegar líneas vacías (keepalive). La conexión se mantiene abierta.

### Implementación en Node (sin dependencias)

```js
const res = await fetch(
  "https://api.core.public.tipminer.com/v1/bac-bo/rounds/cc71e81d-8b56-4868-91c7-7224be543dce/live",
);
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break; // reconectar con backoff
  buf += dec.decode(value, { stream: true });
  const blocks = buf.split("\n\n");
  buf = blocks.pop();
  for (const block of blocks) {
    const m = block.match(/^data: (.+)$/m);
    if (m) console.log(JSON.parse(m[1])); // {uuid, type, result, instant}
  }
}
```

### Reglas del SSE

- **Una sola conexión por mesa** — no abras varias.
- La conexión debe **reconectarse manualmente** tras un corte (con backoff: 5 s, 10 s, 20 s…).
- Mesa pausada = stream abierto pero **sin eventos** (no confundir con caída; verifica `games/status`).
- Consume desde **backend** (Node). Si el front la necesita, expónsela tú a través de tu propia API — no consumas la API de TipMiner desde el navegador.

---

## 7. Buenas prácticas para no saturar (uso responsable)

1. **Tiempo real = SSE, no polling.** El script de test (`test-evolution.cjs`) usa polling de 15 s solo para verificación manual. Para producción, una conexión SSE y listo.
2. Si necesitas polling a `history` (reconexión, backfill): **mínimo 5 s** entre llamadas.
3. **Dedupe por `uuid`**: guarda el último uuid visto; así el SSE puede caerse y reconectarse sin duplicar rondas.
4. **Cache**: `/v1/casinos` 24 h · `/v1/games/status` 10-30 s · el historial de rondas no se cachea (es el dato).
5. **`limit=200` es el máximo real**: no pidas más. Si necesitas más historia, espera a que lleguen rondas nuevas.
6. **Backoff en errores**: 5 s → 10 s → 20 s → máx 60 s. Si falla 5 veces seguidas, revisa `games/status` y considera el provider fallback (Bac Bo ao Vivo).
7. **Los 4xx no se reintentan**: un `404`/`401` significa cambio de ruta o ID equivocado — revisa, no repitas.
8. **Arquitectura del repo**: solo el backend consume la API de TipMiner (scraper → API 3001 → front). El front nunca la llama directo.
9. Uso legítimo y moderado: API pública pero **no documentada y sin garantías** — puede cambiar o cerrarse sin aviso.

---

## 8. Advertencias: fallas y cambios a vigilar

### Endpoints muertos que NO debes usar

- `www.tipminer.com/api/notifications` → **401**
- `api.tipminer.com/...` → **DNS no resuelve** (dominio muerto)
- `tipminer.com/api/v1/notifications`, `www.tipminer.com/br/api/notifications` → **404**
- `www.tipminer.com/br/historico/jonbet/bac-bo` → **308** (redirige a `/br/cassinos/jonbet/bac-bo`)

### Riesgos específicos de tu mesa

| Riesgo                            | Señal                                                     | Mitigación                                                      |
| --------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Mesa pausada por Evolution        | SSE mudo, `lastRoundReceivedAt` viejo, `version` estático | Check `games/status` → switch a Bac Bo ao Vivo (`daed14c3-...`) |
| Cambio de rutas de la API         | `404` en `/v1/bac-bo/rounds/...`                          | Re-analizar el JS del front (ver §9)                            |
| Cambio de esquema                 | Campos faltantes o `version` sin crecer                   | Validar esquema al parsear, nunca asumir                        |
| `version`/`externalId` desaparecen | **Ya ocurrió** (verificado 2026-08-06, ver §5): documentados el 2026-08-01, ausentes 5 días después | Nunca depender de ellos como `NOT NULL`; tratarlos siempre como opcionales que pueden estar completamente ausentes, no solo "a veces faltar" |
| `limit` recortado                 | Pides 500, devuelve 200                                   | Usa 200 y dedupe por uuid                                       |
| Filtros ignorados                 | Mismo resultado con/sin filtro                            | No depender de filtros; filtrar client-side                     |
| `TIE` no contemplado en el parser | Rondas "perdidas"                                         | Aceptar los 3 valores: PLAYER/BANKER/TIE                        |
| IDs cambiados por el casino       | `/v1/casinos` con `timestamps.update` reciente            | Descubrir IDs dinámicos desde `/v1/casinos`, no hardcodear      |
| CORS desde navegador              | Bloqueo al consumir del front                             | Consumir siempre desde backend                                  |

### Cosas que debes saber del dato

- `instant` es **UTC** siempre — conviértelo a `America/Sao_Paulo` tú mismo para mostrar.
- `TIE` existe y comparte puntos (vistos: 7, 7, 8, 10).
- El SSE no trae `version`; si quieres correlacionar con `games/status`, usa la hora aproximada.

---

## 9. Cómo redescubrir la API si algo cambia

La API se descubre en el JavaScript del frontend de TipMiner. Si algo falla:

1. Descarga `https://www.tipminer.com/br/cassinos/evolution/bac-bo` (HTTP 200).
2. Del HTML, localiza los chunks `.js` de Next.js y descárgalos.
3. Busca `api.core.public.tipminer.com` en ellos: aparecen los paths (`/v1/bac-bo/rounds/.../history`, `/live`), parámetros y el mapeo de tipos.
4. Referencia local ya analizada: `%TEMP%\opencode\chunks\` (p. ej. `page-fe1f493e8b9ccb00.js`).

---

## 10. Integración recomendada (con tus IDs)

```
1. /v1/casinos (24h)              → confirmar provider = cc71e81d-8b56-4868-91c7-7224be543dce
2. /v1/games/status (10-30s)      → mesa LIVE? version sube?
3. /v1/bac-bo/rounds/{provider}/history?timezone=America%2FSao_Paulo&limit=200
                                   → historial inicial (más reciente primero)
4. /v1/bac-bo/rounds/{provider}/live → SSE tiempo real, dedupe por uuid
5. ¿SSE mudo >5 min?              → games/status → fallback provider daed14c3-... (ao Vivo)
6. Mapear: type→winner (PLAYER→Casa, BANKER→Banca, TIE→Empate)
           result→marcador (2-12) · instant→timestamp
```

Verificación final: `node server/test-evolution.cjs` (el script del test que ya pasó).

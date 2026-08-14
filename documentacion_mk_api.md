# documentacion_mk_api.md — Guía de consumo de la API (`src/api/`)

> Este documento es la referencia **de consumo**: qué endpoint llamar, qué mandarle, qué te devuelve y por qué. Para el razonamiento arquitectónico (por qué existe cada pieza, decisiones de negocio, alternativas descartadas) ver [`Mk-Api.md`](./Mk-Api.md) — este archivo resume su implementación real, ya construida y verificada en el repo (F1-F5 completos; F6 fuera de alcance, F8/F9 sin código nuevo).

---

## 1. Lo esencial en 30 segundos

- **Base URL:** `http://<host>:<port>/api/v1` (todo bajo este prefijo, salvo `GET /healthz` — ver §8). Puerto default `3000` (`PORT` en `.env`).
- **Auth:** header `X-Api-Key: <secreto>` en **todo** endpoint, salvo `GET /api/v1/health` y `POST /api/v1/auth/login` (§4.12). Sin JWT, sin roles: un único secreto compartido para el frontend propio — que ya no lo incrusta en su build, lo obtiene en runtime vía el login del panel.
- **CORS:** abierto a cualquier origen mientras el proyecto está en desarrollo (`app.enableCors({ origin: true, ... })` en `main.ts`) — un frontend en otro dominio/puerto puede llamar directo desde el navegador sin configuración adicional. Se va a restringir a una allowlist de dominios antes de producción.
- **Formato de respuesta:** siempre JSON, siempre el mismo sobre (`{ data, meta?, requestId }` o `{ error }`) — ver §2.
- **Nada de esto habla con Tipminer/Telegram/Prisma directo**: todo pasa por casos de uso ya existentes en `application/`.
- **⚠️ El motor arranca completamente apagado:** las 2 estrategias existen en código (`streak-3`, `streak-4` — ver `GET /api/v1/strategies`, §4.11) pero **ninguna corre** hasta que se le asigne un canal y ese canal se active vía `PATCH /api/v1/channels/:channel` (§4.7). Un reinicio del proceso vuelve a apagar todo (no hay persistencia de esta configuración) — hay que reconfigurar los canales cada vez que el proceso arranca.
- **Un canal, como máximo una estrategia:** el registro lo garantiza — asignar una estrategia distinta a un canal ya ocupado expulsa automáticamente a la anterior (ver §4.7).

---

## 2. Autenticación

```
X-Api-Key: <valor de la variable de entorno API_KEY>
```

- Configurar `API_KEY` en `.env` (ver `.env.example`). Si no está configurada, **todo** endpoint protegido responde `401` sin importar qué se mande.
- El valor se compara siempre como hash SHA-256 (`timingSafeEqual`), nunca en texto plano — igual que el patrón ya usado por el endpoint admin legado.
- **Endpoints públicos (sin `X-Api-Key`):** `GET /api/v1/health` y `POST /api/v1/auth/login` (§4.12).
- El frontend propio (`Mk-Frontend`) no incrusta `API_KEY` en su build: la obtiene en runtime llamando a `POST /api/v1/auth/login` con una contraseña separada (`ACCESS_PASSWORD`, distinta de `API_KEY`) — ver §4.12.
- Sin ese header (o con uno incorrecto), cualquier otro endpoint responde:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Unauthorized",
    "requestId": "6d00bc2f-ae70-4a50-b937-72dd548132b2",
    "timestamp": "2026-08-11T03:43:10.814Z"
  }
}
```

---

## 3. El sobre de respuesta (envelope)

### 3.1 Éxito

```json
{
  "data": { /* … el resultado, forma distinta por endpoint … */ },
  "meta": { /* opcional: solo en endpoints paginados */ },
  "requestId": "83267c37-a6a5-454d-8675-d4de956e6e97"
}
```

- `data` es siempre lo que documenta cada endpoint más abajo — nunca una entidad interna cruda (nunca verás `payloadOriginal` de Tipminer, hashes, ni el `OperationSnapshot.history` completo).
- `meta` solo aparece en `GET /api/v1/history` (paginación).
- `requestId` viaja siempre — reutiliza el header `X-Request-Id` si lo mandaste, o genera uno nuevo.

### 3.2 Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "El parámetro \"channel\" es obligatorio y debe ser \"oficial\" o \"pruebas\".",
    "details": [{ "reason": "…" }],
    "requestId": "bf52d1cc-f977-4404-b547-2cf2a615625f",
    "timestamp": "2026-08-11T03:36:28.016Z"
  }
}
```

`details` solo aparece cuando hay una lista de razones puntuales (hoy: ninguno de los endpoints existentes lo produce todavía, queda reservado para cuando se adopte `class-validator`).

### 3.3 Códigos de error (`error.code`)

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body/query inválido (campo faltante, tipo incorrecto, valor fuera del enum permitido) |
| `UNAUTHORIZED` | 401 | Falta `X-Api-Key` o no coincide |
| `NOT_FOUND` | 404 | El recurso puntual no existe (p. ej. cancelar una operación que ya no está activa) |
| `CONFLICT` | 409 | La acción choca con el estado actual (p. ej. reasignar una estrategia con operación activa) |
| `INTERNAL` | 500 | Error no esperado — nunca incluye detalle interno ni stack |
| `UNAVAILABLE` | 503 | Reservado para degradación explícita (no producido hoy por ningún endpoint) |
| `FORBIDDEN` | 403 | Reservado — mapeado en el filtro de errores, pero ningún endpoint lo lanza hoy |
| `RATE_LIMITED` | 429 | Reservado — no hay rate limiting implementado todavía (ver §7) |
| `DEPENDENCY_DOWN` | — | Reservado en el enum, sin ningún status HTTP mapeado todavía — no se puede producir hoy |

Un agente que integre esto **no necesita manejar** `FORBIDDEN`/`RATE_LIMITED`/`DEPENDENCY_DOWN` como casos reales todavía; están documentados solo para que el catálogo de `error.code` quede completo.

---

## 4. Catálogo de endpoints

### 4.1 `GET /api/v1/health` — único endpoint público

Sin `X-Api-Key`. Salud del motor + la base de datos.

```json
{
  "data": {
    "ok": true,
    "collectorConnected": true,
    "lastGameReceivedAt": "2026-08-11T03:17:21.710Z",
    "gamesInMemory": 200,
    "activeOperations": 0,
    "registeredStrategies": 3,
    "registeredChannels": 2,
    "lastError": null,
    "db": { "ok": true, "latencyMs": 486 }
  },
  "requestId": "…"
}
```

- `ok` refleja **solo** si el motor sigue recibiendo jugadas (`collectorConnected`). La base de datos es una dependencia opcional del proyecto — su caída se reporta en `db`, pero no apaga `ok`.
- `lastError`: `{ message, occurredAt }` o `null`.
- `db.error` aparece en vez de `db.latencyMs` cuando la conexión falla.

---

### 4.2 `GET /api/v1/statistics`

Estadísticas acumuladas de **todo el histórico** del proceso (no es una ventana — nunca se resetea salvo reinicio).

```json
{
  "data": {
    "totalGames": 205,
    "playerWinRate": 47.8,
    "bankerWinRate": 43.41,
    "tieRate": 8.78,
    "currentStreak": { "winner": "PLAYER", "length": 1 }
  },
  "requestId": "…"
}
```

`currentStreak.winner` es `null` si aún no hay historial.

---

### 4.3 `GET /api/v1/history?limit=`

Ventana en memoria de las últimas jugadas (ring buffer, tope real 200 — **no** hay historial más profundo, ver Mk-Api.md Anexo D §1).

| Query param | Tipo | Default | Notas |
|---|---|---|---|
| `limit` | número | `50` | Se recorta en silencio a `200` si pides más; valores inválidos o ≤0 caen al default — nunca da error |

```json
{
  "data": [
    { "roundId": "019feee3-…", "winner": "BANKER", "score": 12, "playedAt": "2026-08-11T03:35:12.329Z" },
    { "roundId": "019feee3-…", "winner": "BANKER", "score": 7, "playedAt": "2026-08-11T03:35:45.475Z" }
  ],
  "meta": { "limit": 3, "count": 2 },
  "requestId": "…"
}
```

Orden: más antigua primero (igual que llegaron).

---

### 4.4 `GET /api/v1/operations?channel=`

Operaciones **activas** (en curso, no historial) de un canal. `channel` es **obligatorio**.

| Query param | Valores válidos |
|---|---|
| `channel` | `oficial` \| `pruebas` |

Falta o valor inválido → `400 VALIDATION_ERROR`.

```json
{
  "data": [
    {
      "operationId": "b4ce80ae-3b7d-455d-9b6d-d9d52d5ace27",
      "strategyId": "streak-4",
      "recommendedWinner": "PLAYER",
      "streakWinner": "BANKER",
      "currentState": "OPEN",
      "currentMartingale": 0,
      "reason": "Racha de 4 resultados consecutivos de BANKER.",
      "openedAt": "2026-08-11T04:28:10.828Z",
      "closedAt": null
    }
  ],
  "requestId": "…"
}
```

- `currentState`: `OPEN` \| `MG1` \| `MG2` \| `WON` \| `LOST` \| `CANCELLED`.
- `reason`: texto humano del patrón que disparó la señal (p. ej. "Racha de 4 resultados consecutivos de BANKER."). Úsalo para mostrar "qué se detectó" en la tarjeta de operación — es el mismo texto en todos los eventos de esa operación (abrir, MG1, MG2, cierre), nunca cambia durante su ciclo de vida.
- Como máximo hay **una** operación activa por canal (una estrategia por canal); el array normalmente trae 0 o 1 elemento.
- `closedAt` es `null` mientras la operación sigue activa (siempre lo estará en este endpoint, que solo lista activas).
- **Si el canal no tiene ninguna estrategia asignada y activa (§4.6/§4.7), esto siempre devuelve `[]`** — no hay nada evaluando, así que nunca puede haber una operación.

---

### 4.5 `POST /api/v1/operations/:id/cancel`

Cancela manualmente una operación activa (nunca se dispara sola: es un comando explícito).

- **200** — devuelve el `OperationVm` ya en estado `CANCELLED` (mismo shape que §4.4).
- **404** `NOT_FOUND` — no hay ninguna operación activa con ese `id` (ya se resolvió sola, se canceló antes, o el id no existe).

```json
{
  "data": {
    "operationId": "b4ce80ae-…",
    "strategyId": "streak-4",
    "recommendedWinner": "PLAYER",
    "streakWinner": "BANKER",
    "currentState": "CANCELLED",
    "currentMartingale": 0,
    "reason": "Racha de 4 resultados consecutivos de BANKER.",
    "openedAt": "2026-08-11T04:28:10.828Z",
    "closedAt": "2026-08-11T04:30:00.000Z"
  },
  "requestId": "…"
}
```

Sin body. El mismo evento (`operation.cancelled`) llega también por el stream SSE (§4.8) a cualquier cliente conectado.

---

### 4.6 `GET /api/v1/channels/:channel`

Estado actual de la asignación estrategia↔canal, si el canal está activo, y su martingala.

| Path param | Valores válidos |
|---|---|
| `channel` | `oficial` \| `pruebas` |

**Estado por default (proceso recién arrancado, sin ningún `PATCH` todavía):**

```json
{
  "data": {
    "channel": "oficial",
    "strategyId": null,
    "active": false,
    "maxMartingalesOverride": null
  },
  "requestId": "…"
}
```

- `strategyId` es `null` mientras nadie esté asignado a ese canal — es el estado inicial de **ambos** canales al arrancar el proceso, y también puede volver a pasar tras un `PATCH` que reasigna a otro lado.
- `active: false` significa que, aunque haya una estrategia asignada (`strategyId` no nulo), **no está evaluando ni mandando nada** — asignar y activar son dos pasos independientes (§4.7).
- `maxMartingalesOverride` es `null` si nunca se fijó vía `PATCH` — significa "la estrategia usa su propio default de código" (p. ej. 2), no que valga `0`.

---

### 4.7 `PATCH /api/v1/channels/:channel`

Muta, en runtime y sin reiniciar el proceso, cuál estrategia corre en ese canal, si el canal está activo (evalúa + manda alertas), y su `maxMartingales`. **Todo el body es opcional, campo a campo** — solo se aplica lo que mandes.

```jsonc
// Body (todos los campos opcionales)
{
  "strategyId": "streak-4",     // asigna/reasigna la estrategia a este canal
  "active": true,                // enciende el canal: la estrategia asignada empieza a evaluar Y a mandar alertas
  "maxMartingales": 3           // aplica a la estrategia que quede asignada a este canal (la nueva, si vino en el mismo body)
}
```

**Una estrategia (`streak-3`, `streak-4`, o cualquier otra que se registre a futuro — ver `GET /api/v1/strategies`, §4.11) solo evalúa/opera cuando está asignada a un canal Y ese canal tiene `active: true`.** Esto no está fijo en el código de ninguna estrategia — es 100% lo que digan estos dos campos en runtime. Al arrancar el proceso, ninguna estrategia está asignada y ningún canal está activo: hay que configurar esto explícitamente (típicamente una vez por cada arranque del proceso, ya que no persiste — ver §1).

**Invariante: nunca más de una estrategia por canal.** Si `channel` ya tenía otra estrategia distinta asignada, asignar `strategyId` **expulsa automáticamente** a la anterior (queda `strategyId: null` en su propio canal si vuelves a consultarla, deja de evaluar de inmediato) como parte de la misma llamada — no hace falta (ni existe) un paso previo de "desasignar". No hay forma de dejar un canal explícitamente sin estrategia una vez que tuvo una asignada, salvo asignarle una estrategia distinta encima (ver §7).

Reglas y errores:

| Situación | Resultado |
|---|---|
| `strategyId` no es un string no vacío | `400 VALIDATION_ERROR` |
| La estrategia de `strategyId` tiene una operación activa **ahora mismo** | `409 CONFLICT` — la reasignación se rechaza por completo, no se aplica nada. Hay que esperar a que cierre o cancelarla primero (§4.5) |
| El canal destino ya tenía **otra** estrategia asignada, y esa otra tiene una operación activa ahora mismo | `409 CONFLICT` — misma protección que la fila anterior, pero del lado de la estrategia que sería expulsada: tampoco se le puede quitar el canal por debajo mientras opera. El mensaje de error no distingue cuál de las dos estrategias es la que bloquea; si te da 409, revisa `GET /api/v1/operations?channel=...` de ambos lados |
| `active` no es booleano | `400 VALIDATION_ERROR` |
| `maxMartingales` no es un número ≥ 0 | `400 VALIDATION_ERROR` |
| `maxMartingales` viene pero el canal no tiene ninguna estrategia asignada | `400 VALIDATION_ERROR` |
| `channel` no es `oficial`/`pruebas` | `400 VALIDATION_ERROR` |

**⚠️ Gap conocido, sin corregir todavía — no manden `maxMartingales >= 3`:** la validación de este campo solo exige "número finito ≥ 0", pero `core/operation/operation.entity.ts` **nunca soportó más de 2 martingalas** (la máquina de estados de una `Operation` es `OPEN → MG1 → MG2 → WON/LOST`, sin ningún estado para una 3ra pérdida consecutiva). Si configuras `maxMartingales: 3` (o más) y una operación real llega a esa 3ra pérdida, el motor lanza una excepción interna, descarta **esa** operación (`ActiveOperationRegistry` la borra) y lo único que queda visible es un `lastError` genérico en `GET /api/v1/health` — sin tumbar el proceso, pero sin cerrar la operación como `WON`/`LOST` tampoco (simplemente desaparece de `GET /operations`, sin pasar por `operation.won`/`operation.lost` en el SSE). Hasta que esto se corrija en el backend: **el frontend nunca debe permitir configurar `maxMartingales` por encima de `2`.**

Respuesta exitosa: mismo shape que `GET /api/v1/channels/:channel`, ya con los cambios aplicados. Ejemplo — configurar `oficial` desde cero en un solo `PATCH`:

```json
// PATCH /api/v1/channels/oficial  { "strategyId": "streak-4", "active": true }
{
  "data": { "channel": "oficial", "strategyId": "streak-4", "active": true, "maxMartingalesOverride": null },
  "requestId": "…"
}
```

**Efecto inmediato:** asignar, reasignar, activar o desactivar aplica a la **siguiente** jugada/notificación, sin reiniciar el proceso (verificado con el motor corriendo en vivo — al activar, la estrategia empieza a evaluar desde la próxima jugada que llegue; al desactivar, deja de evaluar y de mandar alertas de inmediato). El `maxMartingales` nuevo solo afecta a operaciones que se abran **después** del cambio — una operación ya en curso conserva el valor que tenía al abrirse.

**Alcance de lo que NO cambia:** los reportes históricos (`RESUMEN`, resumen horario, y `GET /api/v1/reports/summary` del §4.10) agrupan por una tabla estática interna del código (`streak-4`/`streak-3` → oficial; hoy ninguna estrategia cae en "pruebas" ahí), **completamente separada** de esta asignación en runtime — nunca reflejan lo que configures acá. Es deliberado: es un mecanismo distinto, pensado para que una operación ya cerrada pertenezca siempre al grupo bajo el que realmente se notificó, sin importar reasignaciones posteriores.

---

### 4.8 `GET /api/v1/events/stream` — Server-Sent Events (SSE)

Canal en vivo único para: última jugada, % rodante de aciertos, y cada transición de operación. Requiere `X-Api-Key` (ver nota abajo sobre clientes que no pueden mandar headers custom).

**Formato de cada mensaje** (SSE estándar):

```
event: <tipo>
id: <consecutivo>
data: <JSON>

```

Donde el JSON de `data` siempre tiene esta forma:

```json
{ "type": "<tipo>", "payload": { /* … */ }, "occurredAt": "2026-08-11T04:28:10.828Z" }
```

**Tipos de evento:**

| `type` | `payload` | Cuándo |
|---|---|---|
| `game.received` | `{ roundId, winner, score, playedAt }` | Cada jugada nueva en vivo (nunca las históricas de arranque) |
| `stats.rolling` | `{ window: 200\|50, playerPct, bankerPct, tiePct }` | Dos por cada jugada nueva (una por ventana). **No** es lo mismo que `GET /statistics` — esto es sobre las últimas 200/50, no el acumulado histórico total |
| `operation.opened` | `OperationVm` completo (mismo shape que §4.4) | Se abrió una operación nueva |
| `operation.mg1` / `operation.mg2` | `OperationVm` completo | La operación avanzó de martingala |
| `operation.tie` | `OperationVm` completo | Llegó un TIE mientras la operación seguía activa (no cambia su estado) |
| `operation.won` / `operation.lost` | `OperationVm` completo | La operación cerró por resultado de jugada |
| `operation.cancelled` | `OperationVm` completo | La operación se cerró por `POST /operations/:id/cancel` |

**Importante:** cada evento de operación trae el `OperationVm` **completo y actualizado**, nunca un diff — el frontend reemplaza su estado en memoria directo, sin tener que recombinar campos. Para saber a qué canal/página pertenece un evento de operación, usa su `strategyId` (compáralo contra `GET /api/v1/channels/:channel` para saber de qué canal es en ese momento).

**El stream es un único broadcast**: todos los clientes conectados reciben exactamente los mismos eventos, sin segmentar por canal — el filtrado por `strategyId`/canal es responsabilidad del cliente, no del servidor.

**Ejemplo real capturado en vivo:**

```
event: operation.mg1
id: 1
data: {"type":"operation.mg1","payload":{"operationId":"e16635df-…","strategyId":"streak-4","recommendedWinner":"PLAYER","streakWinner":"BANKER","currentState":"MG1","currentMartingale":1,"reason":"Racha de 4 resultados consecutivos de BANKER.","openedAt":"2026-08-11T04:27:32.830Z","closedAt":null},"occurredAt":"2026-08-11T04:28:10.826Z"}

event: game.received
id: 2
data: {"type":"game.received","payload":{"roundId":"019fef13-…","winner":"BANKER","score":9,"playedAt":"2026-08-11T04:28:11.765Z"},"occurredAt":"2026-08-11T04:28:10.828Z"}

event: stats.rolling
id: 3
data: {"type":"stats.rolling","payload":{"window":200,"playerPct":46,"bankerPct":43,"tiePct":11},"occurredAt":"2026-08-11T04:28:10.828Z"}
```

**Nota para el frontend — headers en SSE:** el `EventSource` nativo del navegador **no permite mandar headers custom** como `X-Api-Key`. Si el frontend necesita usar `EventSource` tal cual, hace falta una de estas dos cosas (a decidir cuando exista el frontend real, no resuelto en este backend):
1. Un cliente SSE basado en `fetch` (p. ej. `@microsoft/fetch-event-source` o similar) que sí puede mandar headers.
2. O una excepción de auth específica para esta ruta (no implementada — hoy `X-Api-Key` es obligatorio también acá).

**Pendiente de diseño, sin resolver (documentado, no bloqueante):** no hay límite de conexiones simultáneas ni backpressure por cliente lento — un cliente que no lee su buffer podría, en teoría, acumular memoria en el proceso. Ver Mk-Api.md Anexo B.5.

---

### 4.9 `POST /api/v1/admin/reports?channel=`

Genera y despacha el resumen completo (comando `RESUMEN`): es el **único** endpoint administrativo del sistema — el viejo `POST /admin/commands` (contraseña en el body, fuera de `/api/v1`) se retiró del código por completo, ya no existe ninguna ruta con ese path. Este es el que hay que usar, autenticado con `X-Api-Key` igual que el resto de la API.

**Pensado explícitamente para un botón del frontend** (p. ej. "Enviar resumen ahora" en el panel de administración): un único `POST`, sin body, con el `channel` que elija el usuario. Como sí manda un mensaje real (ver el aviso abajo), conviene deshabilitar el botón mientras la petición está en curso y, si el frontend quiere ser explícito, pedir una confirmación antes de disparar el `POST` — no hay nada en el backend que lo debounce por vos.

| Query param | Valores válidos | Default |
|---|---|---|
| `channel` | `oficial` \| `pruebas` \| `todos` | `todos` |

**⚠️ Efecto real:** este endpoint dispara un mensaje real a Telegram (a los chats configurados en `.env`). No lo llames en pruebas contra un despliegue con tokens reales configurados, salvo que quieras que el mensaje llegue de verdad. Si necesitás los mismos números **sin** ese efecto secundario (para pintar un dashboard que se refresca solo), usá `GET /api/v1/reports/summary` (§4.10) en su lugar.

**201 Created** (default de Nest para `POST`, no hay `@HttpCode` que lo cambie — a diferencia de §4.5, que sí fuerza `200`):

```json
{
  "data": {
    "channel": "todos",
    "dispatchedAt": "2026-08-11T04:17:44.000Z",
    "metrics": {
      "oficial": { /* SummaryReportResult del grupo oficial */ },
      "pruebas": { /* SummaryReportResult del grupo pruebas */ }
    }
  },
  "requestId": "…"
}
```

`channel` inválido (no es uno de los tres valores) → `400 VALIDATION_ERROR`.

---

### 4.10 `GET /api/v1/reports/summary`

Ganadas, perdidas y alertas enviadas por canal, más el tiempo activo del proceso — **de solo lectura, sin ningún efecto secundario** (a diferencia de `POST /api/v1/admin/reports`, §4.9, este endpoint nunca manda nada a Telegram). Pensado exactamente para que el dashboard del frontend lo sondee con la frecuencia que quiera.

Sin query params, sin body. Siempre trae ambos canales en la misma respuesta.

```json
{
  "data": {
    "uptimeMs": 7384521,
    "oficial": { "won": 8, "lost": 2, "alertsSent": 10 },
    "pruebas": { "won": 0, "lost": 0, "alertsSent": 0 }
  },
  "requestId": "…"
}
```

- `uptimeMs`: milisegundos desde que arrancó **el proceso** (no desde que se activó un canal) — es el mismo valor en `oficial` y `pruebas`, se expone una sola vez.
- `won`/`lost`/`alertsSent`: acumulado de **todo el historial en memoria desde que arrancó el proceso** (mismo criterio que `POST /admin/reports` y que el comando legado `RESUMEN`) — nunca se resetea salvo reinicio, no es una ventana de tiempo.
- Si querés más detalle (`effectivenessPct`, `directWins`, `martingaleOneWins`, distribución, mejores/peores rachas, etc.), esos campos siguen existiendo internamente (`SummaryMetricsSnapshot`) pero **no se exponen acá a propósito** — este endpoint solo proyecta los tres números que se pidieron para el dashboard. Si el frontend necesita el detalle completo, usa `POST /api/v1/admin/reports` (§4.9) sabiendo que esa llamada sí dispara Telegram.

---

### 4.11 `GET /api/v1/strategies`

Catálogo estático de qué estrategias existen hoy en código — pensado para poblar un `<select>` en el frontend antes de llamar a `PATCH /api/v1/channels/:channel` con un `strategyId` válido.

Sin query params, sin body.

```json
{
  "data": [
    {
      "id": "streak-3",
      "name": "Streak3Strategy",
      "description": "Recomienda el ganador opuesto tras 3 resultados consecutivos iguales."
    },
    {
      "id": "streak-4",
      "name": "Streak4Strategy",
      "description": "Recomienda el ganador opuesto tras 4 resultados consecutivos iguales."
    }
  ],
  "requestId": "…"
}
```

- El **orden y el contenido** de este arreglo son exactamente las estrategias registradas en `StrategyModule` — si agregan una estrategia nueva al backend, aparece acá sola, sin ningún otro cambio de contrato.
- Esto es el catálogo (qué existe), **no** el estado de runtime (qué canal la tiene asignada, si está activa). Para eso, cruza cada `id` con `GET /api/v1/channels/oficial` y `GET /api/v1/channels/pruebas`.
- No incluye ningún dato de martingala/comportamiento — `maxMartingales` efectivo de una estrategia se lee siempre desde `GET /api/v1/channels/:channel` (`maxMartingalesOverride`, con el default de código si es `null`, hoy `2`).

---

### 4.12 `POST /api/v1/auth/login` — Login Gateway del panel frontend

Segundo (y único otro) endpoint público junto a `GET /api/v1/health`: no requiere `X-Api-Key`. Existe para que el frontend (`AccessGate`, panel de Mk-Frontend) nunca tenga que incrustar `X-Api-Key` en su JS compilado — en vez de eso, pide una contraseña al usuario, la manda acá, y si acierta recibe la API key real para usarla el resto de la sesión (en memoria/`sessionStorage` del navegador, nunca en el bundle de build).

**Body:**

```json
{ "password": "la-contraseña-del-panel" }
```

**200 — contraseña correcta:**

```json
{
  "data": { "apiKey": "el-valor-real-de-API_KEY" },
  "requestId": "…"
}
```

**401 — contraseña incorrecta, vacía, o `ACCESS_PASSWORD`/`API_KEY` sin configurar en el backend** (mismo código en los tres casos, a propósito — no dar pistas de cuál es el problema):

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Contraseña incorrecta.",
    "requestId": "…",
    "timestamp": "…"
  }
}
```

- Se compara siempre como hash SHA-256 (`timingSafeEqual`), nunca en texto plano — mismo patrón que `ApiKeyGuard` (§2), implementado independiente en `auth.controller.ts` (duplicación intencional de 3 líneas, no vale una dependencia cruzada por tan poco).
- **Rate limit propio y mucho más estricto que el resto de la API:** 5 intentos/minuto por IP (`@Throttle`, ver `AppModule`/§ rate limiting), en vez de los 300/min globales — este es el único endpoint donde tiene sentido un ataque de fuerza bruta, porque es el único que acepta un secreto sin haberlo validado antes.
- No tiene sentido de negocio, es puro control de acceso al panel — no toca nada de `application/` ni `core/`.

---

## 5. Cómo se relacionan `operations`, `channels` y `events/stream` (flujo típico de una página del frontend)

**0. Antes de que cualquier estrategia haga algo** (típicamente una vez por cada arranque del proceso, ver §1): pintar el selector con `GET /api/v1/strategies` (§4.11) y configurar los canales con lo que elija el usuario, por ejemplo:

```
PATCH /api/v1/channels/oficial  { "strategyId": "streak-4", "active": true }
PATCH /api/v1/channels/pruebas  { "strategyId": "streak-3", "active": true }
```

(`streak-3` en el canal de pruebas es solo un ejemplo — cualquier `id` que devuelva `GET /api/v1/strategies` sirve para cualquiera de los dos canales; no hay ninguna afinidad fija estrategia↔canal en el código.) Sin este paso, `GET /api/v1/channels/:channel` devuelve `strategyId: null, active: false` para ambos, y `GET /api/v1/operations?channel=...` nunca va a devolver nada porque nada está evaluando.

Cada página del frontend (`/panel/oficial`, `/panel/pruebas`) sigue este patrón:

1. **Al cargar la página** — `GET`s para hidratar el estado inicial:
   - `GET /api/v1/channels/oficial` → saber qué estrategia está asignada y si el canal está activo (útil también para la UI de configuración).
   - `GET /api/v1/operations?channel=oficial` → operación activa de ese canal, si hay alguna (solo puede haberla si el canal está/estuvo activo).
   - `GET /api/v1/history?limit=200` → las últimas jugadas para pintar el historial/gráfico inicial.
   - `GET /api/v1/reports/summary` (§4.10) → ganadas/perdidas/alertas/uptime para las tarjetas de resumen (sin disparar Telegram).
2. **Después de cargar** — una sola conexión a `GET /api/v1/events/stream`:
   - `game.received`/`stats.rolling` actualizan el historial y los porcentajes en vivo.
   - `operation.*` con `strategyId` de la estrategia de ese canal actualiza (o crea/cierra) la tarjeta de operación activa — reemplazando el estado completo, nunca mezclando campos. Usa `reason` para mostrar qué patrón se detectó.
3. **Acciones del usuario:**
   - Cancelar → `POST /api/v1/operations/:id/cancel` (la confirmación llega también por el stream, no hace falta releer con `GET`).
   - Cambiar configuración (elegir estrategia del selector de `GET /api/v1/strategies`, activar/desactivar, martingala — nunca por encima de `2`, ver §4.7) → `PATCH /api/v1/channels/:channel`.
   - Refrescar las tarjetas de ganadas/perdidas/alertas → volver a pedir `GET /api/v1/reports/summary` (sondealo con el intervalo que quieras, no tiene costo de Telegram).

---

## 6. Fechas, tipos y convenciones

- **Fechas:** siempre string ISO-8601 UTC (`"2026-08-11T04:28:10.828Z"`). Nunca objetos `Date` ni timestamps numéricos.
- **IDs:** siempre string (uuid). No hay IDs numéricos en ningún endpoint hoy.
- **Ausencia de valor:** siempre `null` explícito en JSON, nunca el campo omitido ni `undefined` (ver `closedAt`, `lastError`, `strategyId` en `channels`, `maxMartingalesOverride`).
- **Enums que viajan como string plano:** `winner`/`recommendedWinner`/`streakWinner` (`PLAYER`\|`BANKER`\|`TIE`), `currentState` (`OPEN`\|`MG1`\|`MG2`\|`WON`\|`LOST`\|`CANCELLED`), `channel` (`oficial`\|`pruebas`).

---

## 7. Qué NO existe todavía (fuera de alcance, a propósito)

- **`GET /api/v1/results`** (historial profundo desde la base de datos `jugadas`) — no se activó la ingesta a la tabla; solo existe la ventana en memoria de 200 jugadas (§4.3). Ver Mk-Api.md Anexo D §1.
- **Allowlist de CORS por dominio** — implementada vía la variable de entorno `CORS_ALLOWED_ORIGINS` (coma-separada, ver `.env.example`). Sin definirla, `main.ts` cae a `origin: true` (cualquier origen) para no bloquear el desarrollo local; en el despliegue real hay que fijarla con el/los dominio(s) reales del frontend.
- **Rate limiting** — implementado con `@nestjs/throttler` como `APP_GUARD` global (`AppModule`): por defecto 300 requests/minuto por IP (`RATE_LIMIT_LIMIT`/`RATE_LIMIT_TTL_MS`, ver `.env.example`), suficiente margen para el patrón de sondeo descrito en §5. Al excederlo, la API responde `429 Too Many Requests` con el mismo envelope de error (`ApiErrorCode.RATE_LIMITED`). `GET /api/v1/events/stream` (SSE) está exento — es una conexión larga, no peticiones repetidas.
- **Roles/multiusuario/JWT** — decisión de negocio: un único secreto compartido es suficiente, no hay operadores humanos diferenciados.
- **Backpressure/límite de clientes SSE** — ver §4.8.
- **Desasignar explícitamente una estrategia de un canal** (`strategyId: null` vía `PATCH`) — no soportado; la única forma de "vaciar" un canal es asignarle otra estrategia distinta (ver §4.7).
- **Validar el techo real de `maxMartingales` (2) en `PATCH /api/v1/channels/:channel`** — la API acepta hoy cualquier valor ≥ 0; enviar 3 o más rompe la operación cuando llega a esa martingala (ver el aviso en §4.7). Pendiente de corregir en el backend.

---

## 8. El único endpoint fuera de `/api/v1`

| Endpoint | Auth | Formato de respuesta | Notas |
|---|---|---|---|
| `GET /healthz` | ninguna | `{ status: "ok", ...snapshot crudo }` | Sin envelope. Pensado para healthchecks de plataforma/infraestructura (Railway/Render/etc.), no para el frontend — para eso está `GET /api/v1/health` (§4.1) |

**El viejo `POST /admin/commands` (contraseña `ADMIN_PASSWORD` en el body) ya no existe** — se retiró del código junto con toda la administración de contraseñas: ese controller, su módulo y el hasher se borraron, `ADMIN_PASSWORD` ya no se lee de `.env`, y `main.ts` ya no necesita excluirlo de `setGlobalPrefix`. Todo lo administrativo vive ahora en `POST /api/v1/admin/reports` (§4.9), dentro de la API, con la misma auth (`X-Api-Key`) que cualquier otro endpoint.

---

## 9. Variables de entorno relevantes para la API

| Variable | Para qué |
|---|---|
| `API_KEY` | Secreto compartido que exige `X-Api-Key` en toda la API nueva. Sin ella, todo responde 401 |
| `ACCESS_PASSWORD` | Contraseña del login del panel (`POST /api/v1/auth/login`, §4.12). Sin ella, ese endpoint rechaza cualquier contraseña |
| `CORS_ALLOWED_ORIGINS` | Allowlist de orígenes CORS, coma-separada. Sin definir, acepta cualquier origen |
| `RATE_LIMIT_LIMIT` / `RATE_LIMIT_TTL_MS` | Tope/ventana del rate limit global por IP (default 300/60000ms) |
| `PORT` | Puerto HTTP (ya existía, sin cambios) |

Ver `.env.example` para la lista completa (incluye las de Telegram/Tipminer/DB, no específicas de esta capa).

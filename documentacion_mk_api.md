# documentacion_mk_api.md — Guía de consumo de la API (`src/api/`)

> Este documento es la referencia **de consumo**: qué endpoint llamar, qué mandarle, qué te devuelve y por qué. Para el razonamiento arquitectónico (por qué existe cada pieza, decisiones de negocio, alternativas descartadas) ver [`Mk-Api.md`](./Mk-Api.md) — este archivo resume su implementación real, ya construida y verificada en el repo (F1-F5 completos; F8/F9 sin código nuevo). La F6 de aquel plan era `GET /api/v1/results`, un listado crudo y paginado de `jugadas`: **sigue sin existir y ya no se planea**, porque la necesidad real resultó ser evidencia estadística agregada y eso lo cubre el recurso `analytics/racha3` (§4.13, `Mk-Api.md` ADR-13).

---

## 1. Lo esencial en 30 segundos

- **Base URL:** `http://<host>:<port>/api/v1` (todo bajo este prefijo, salvo `GET /healthz` — ver §8). Puerto default `3000` (`PORT` en `.env`).
- **Auth:** header `X-Api-Key: <secreto>` en **todo** endpoint, salvo `GET /api/v1/health` y `POST /api/v1/auth/login` (§4.12). Sin JWT, sin roles: un único secreto compartido para el frontend propio — que ya no lo incrusta en su build, lo obtiene en runtime vía el login del panel.
- **CORS:** abierto a cualquier origen mientras el proyecto está en desarrollo (`app.enableCors({ origin: true, ... })` en `main.ts`) — un frontend en otro dominio/puerto puede llamar directo desde el navegador sin configuración adicional. Se va a restringir a una allowlist de dominios antes de producción.
- **Formato de respuesta:** siempre JSON, siempre el mismo sobre (`{ data, meta?, requestId }` o `{ error }`) — ver §2.
- **Nada de esto habla con Tipminer/Telegram/Prisma directo**: todo pasa por casos de uso ya existentes en `application/`.
- **Analytics histórico:** `GET /api/v1/analytics/racha3/*` (§4.13) expone evidencia estadística sobre las ~42.500 jugadas persistidas. Es el único recurso que **depende de la base de datos**: sin `DATABASE_URL` responde `503`. Tres reglas antes de consumirlo — no predice nada, `frecuencia_historica` y `tasa_empirica_condicionada` no son comparables, y las tasas son **fracciones** en [0,1], no porcentajes. Ver §4.13.
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
    "oficial": { "won": 8, "lost": 2, "alertsSent": 10, "netUnits": -6 }
  },
  "requestId": "…"
}
```

- `uptimeMs`: milisegundos desde que arrancó **el proceso** (no desde que se activó un canal).
- `won`/`lost`/`alertsSent`: acumulado de **todo el historial** (mismo criterio que `POST /admin/reports` y que el comando legado `RESUMEN`), no es una ventana de tiempo. Desde el 2026-09-05 **sobrevive un reinicio/redeploy del proceso**: se respalda periódicamente en la tabla `report_checkpoints` (Postgres/Supabase, ver `DATABASE.md` §10) y se restaura al arrancar — el contrato HTTP no cambia, solo deja de perderse el acumulado cuando el proceso se reinicia (p. ej. un redeploy en Vercel/Railway).
- `netUnits`: `won - lost * 7` — unidades reales de ganancia/pérdida, calculadas **solo** sobre lo contado en `oficial` (nunca mezcla `pruebas`, que ni siquiera viaja en este contrato — ver más abajo). El `7` es la progresión de martingala del motor (`OPEN` 1 unidad + `MG1` 2 + `MG2` 4 = 7 unidades apostadas en total si se pierde la operación completa); una victoria siempre cierra dejando 1 unidad neta, sin importar en qué fase ganó (directa, MG1 o MG2). Se calcula en `core/reporting/report-metrics.calculator.ts` (`calculateReportMetrics`), la misma función que produce `won`/`lost`, así que viaja también en `SummaryMetricsSnapshot` y en el detalle interno de `POST /admin/reports` — acá solo se proyecta.
- **Este contrato solo expone `oficial`** (no hay clave `pruebas` en la respuesta, por diseño — ver el comentario en `reports-summary.vm.ts`), así que `netUnits` es también, por construcción, exclusivamente sobre lo que se notificó por el canal oficial.
- Si querés más detalle (`effectivenessPct`, `directWins`, `martingaleOneWins`, distribución, mejores/peores rachas, etc.), esos campos siguen existiendo internamente (`SummaryMetricsSnapshot`) pero **no se exponen acá a propósito** — este endpoint solo proyecta los cuatro números que se pidieron para el dashboard. Si el frontend necesita el detalle completo, usa `POST /api/v1/admin/reports` (§4.9) sabiendo que esa llamada sí dispara Telegram.

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


### 4.13 `GET /api/v1/analytics/racha3/*` — Analytics histórico (8 GET + 1 POST)

Evidencia histórica sobre la estrategia Racha 3, calculada sobre las ~42.500 jugadas persistidas. Referencia completa del dominio en [`ANALYTICS.md`](./ANALYTICS.md); decisiones de diseño en `Mk-Api.md` ADR-13.

#### Antes de consumir estos endpoints: tres reglas del contrato

**1. Analytics no predice ni decide alertas.** Describe lo que ya ocurrió. Ningún campo se llama `probabilidad`, `prediccion` ni `confianza`, y eso es deliberado: convertir una frecuencia histórica en probabilidad predictiva exige supuestos que estos datos no contienen. La decisión de alertar la mantiene el Core.

**2. `frecuencia_historica` y `tasa_empirica_condicionada` son magnitudes distintas y NO comparables.**

| Campo | Qué es | Suma 1 |
|---|---|---|
| `frecuencia_historica` | Proporción de los casos observados que cayeron en esa categoría | **Sí** |
| `tasa_empirica_condicionada` | Proporción de veces que ocurrió el evento entre los casos que llegaron a estar **en riesgo** (hazard empírico) | **No** |

Sobre el histórico actual llegan a ordenar los buckets al revés: `0-5` es el segundo bucket más frecuente (0,25) y a la vez el de **menor** tasa condicionada (0,053). Leer uno creyendo estar leyendo el otro es el error más fácil de cometer con esta API.

**3. Las tasas son FRACCIONES en [0,1], nunca porcentajes.** Toda respuesta que lleva tasas lo declara en `unidad_tasas: "fraccion_0_1"`. Multiplicá por 100 sólo al presentar. Junto a cada proporción va su conteo crudo, para que puedas recomputarla.

Y una regla de lectura: **toda tasa viene con su `muestra_n`**. Con ~170 observaciones por hora, una diferencia de varios puntos entre dos horas es compatible con el azar. Cuando `muestra_n` está por debajo del umbral, la respuesta trae `advertencia_muestra` no nula.

#### Parámetros comunes a los 8 GET

| Parámetro | Tipo | Default | Notas |
|---|---|---|---|
| `desde` | ISO-8601 | — | Inicio de la ventana sobre `confirmacion_en`, **inclusive** |
| `hasta` | ISO-8601 | — | Fin, **exclusive**. La ventana es `[desde, hasta)` |
| `tipo` | `PLAYER` \| `BANKER` | ambos | |
| `incluir_bloqueadas` | `true` \| `false` | **`false`** | Oportunidades que el motor real no habría podido operar (había una operación abierta). Excluidas por defecto porque el consumidor natural es el Core |
| `incluir_integridad_dudosa` | `true` \| `false` | **`true`** | Oportunidades con un hueco del historial en su ventana. Incluidas por defecto — son observaciones reales — pero su cantidad viaja siempre en `muestra_integridad_dudosa` |
| `umbral_muestra` | entero 1–100000 | `100` | Bajo este `muestra_n` se emite `advertencia_muestra` |

Los defaults son **asimétricos a propósito**: las bloqueadas se excluyen porque distorsionarían la lectura del Core; las de integridad dudosa se incluyen porque excluirlas por defecto sería descartar datos en silencio. En ambos casos la respuesta dice cuántas filas están involucradas.

#### Validación

Todo valor desconocido o mal formado devuelve **400 `VALIDATION_ERROR`**. No hay defaults silenciosos: un typo en `tipo=PLAYERR` que devolviera el total de ambos lados sería peor que un error.

| Regla | Ejemplos rechazados |
|---|---|
| `tipo` ∈ {`PLAYER`,`BANKER`} | `PLAYERR`, `player`, `TIE` |
| Booleanos: sólo `"true"`/`"false"` | `1`, `0`, `yes`, `TRUE`, `on` |
| Fechas ISO-8601 parseables, `desde < hasta`, rango ≤ **366 días** | `ayer`, ventana invertida, extremos iguales, rango de 26 años |
| `metrica` ∈ {`jugadas`,`columnas`,`segundos`} | `minutos` |
| `entre` ∈ {`RACHA3`,`PERDIDAS`} | `perdidas` |
| `cotas`: CSV de enteros, 1–12 valores, cada uno 1–1.000.000, **estrictamente creciente** | `10,5`, `5,5`, `5,a`, `0,5`, 13 valores, `99999999` |
| `umbral_muestra` entero 1–100000 | `0` |
| `maximo` entero 2–50 | `1`, `999` |

`cotas` exige orden estricto porque con valores desordenados el etiquetado produciría buckets sin sentido (`"8-5"`) en vez de fallar, y recibirías una distribución incoherente en lugar de un error.

Si la base de datos no está disponible, los endpoints responden **503 `UNAVAILABLE`** (a diferencia del scheduler interno, que en ese caso simplemente no procesa).

---

#### 4.13.1 `GET /api/v1/analytics/racha3/resumen`

Frecuencia y resultado de operaciones. Una sola fila de datos.

```json
{
  "data": {
    "unidad_tasas": "fraccion_0_1",
    "zona_horaria": "America/Bogota",
    "ventana": { "desde": "2026-08-21T18:23:15.232Z", "hasta": "2026-09-08T01:47:47.859Z" },
    "frecuencia": {
      "total": 4069, "resueltas": 4069, "pendientes": 0,
      "player": 2011, "banker": 2058,
      "frecuencia_historica_player": 0.4942,
      "frecuencia_historica_banker": 0.5058
    },
    "resultados": {
      "directa": 2041, "mg1": 1011, "mg2": 522, "perdidas": 495,
      "tasa_directa": 0.5017,
      "tasa_mg1": 0.2485,
      "tasa_mg2": 0.1284,
      "tasa_perdida": 0.1199,
      "tasa_acierto_total": 0.8801
    },
    "muestra_n": 4069,
    "muestra_bloqueadas_excluidas": 50,
    "muestra_integridad_dudosa": 10,
    "advertencia_muestra": null
  },
  "requestId": "…"
}
```

`muestra_n` = **las resueltas**, nunca el total: una operación todavía abierta no tiene resultado, y meterla en el denominador deprimiría artificialmente todas las tasas. `tasa_directa + tasa_mg1 + tasa_mg2 + tasa_perdida = 1`, y `tasa_acierto_total = 1 − tasa_perdida`.

#### 4.13.2 `GET /api/v1/analytics/racha3/intervalos`

Estadísticos de los intervalos entre Racha 3, en las **tres unidades a la vez**, más su distribución por buckets.

Query propio: `entre` (`RACHA3` default \| `PERDIDAS`), `metrica` (`jugadas` default), `cotas`.

```json
{
  "data": {
    "entre": "RACHA3",
    "metrica": "jugadas",
    "cotas": [5, 10, 15, 20, 30, 50],
    "intervalos": [
      { "metrica": "columnas", "muestra_n": 4068, "minimo": 1, "p25": 2, "mediana": 5,
        "p75": 8, "p90": 13, "p99": 26, "maximo": 57, "promedio": 6.26,
        "desviacion": 6.41, "advertencia_muestra": null },
      { "metrica": "jugadas",  "muestra_n": 4068, "minimo": 3, "p25": 5, "mediana": 8,
        "p75": 13, "p90": 20, "p99": 37, "maximo": 74, "promedio": 10.45,
        "desviacion": 8.02, "advertencia_muestra": null },
      { "metrica": "segundos", "muestra_n": 4068, "minimo": 92, "p25": 190, "mediana": 290,
        "p75": 452, "p90": 697, "p99": 1301.4, "maximo": 12518, "promedio": 366.86,
        "desviacion": 340.1, "advertencia_muestra": null }
    ],
    "distribucion": [
      { "bucket": "0-5",   "orden": 1, "n": 1034, "frecuencia_historica": 0.2542, "muestra_n": 4068, "metrica": "jugadas" },
      { "bucket": "6-10",  "orden": 2, "n": 1551, "frecuencia_historica": 0.3813, "muestra_n": 4068, "metrica": "jugadas" },
      { "bucket": "51+",   "orden": 7, "n": 8,    "frecuencia_historica": 0.002,  "muestra_n": 4068, "metrica": "jugadas" }
    ]
  },
  "requestId": "…"
}
```

Las tres unidades van juntas a propósito: mirar sólo una induce a conclusiones que la otra desmiente — un intervalo corto en jugadas puede ser largo en tiempo si hubo un hueco en el historial. Y la distribución acompaña a la mediana porque en una distribución con cola larga el valor típico no es representativo.

Se devuelven **todos** los buckets, incluso los vacíos (`n: 0`): un bucket ausente se confunde con "no consultado".

> **Es el endpoint más lento (~910 ms).** Deuda técnica conocida y aceptada: sus dos consultas recomputan la misma serie de distancias y compiten por CPU. Ver `ANALYTICS.md` §11.3.

#### 4.13.3 `GET /api/v1/analytics/racha3/por-hora`

Análisis temporal en hora Colombia. **Siempre las 24 horas**, incluso las que no tienen ninguna oportunidad: una hora ausente se leería como "no hay datos", mientras que una fila con `muestra_n: 0` lo dice explícitamente.

```json
{
  "data": {
    "unidad_tasas": "fraccion_0_1",
    "zona_horaria": "America/Bogota",
    "ventana": { "desde": "…", "hasta": "…" },
    "horas": [
      { "hora_col": 0, "total": 168, "frecuencia_historica": 0.0413,
        "resueltas": 168, "directa": 88, "mg1": 41, "mg2": 20, "perdidas": 19,
        "tasa_directa": 0.5238, "tasa_mg1": 0.2440, "tasa_mg2": 0.1190,
        "tasa_perdida": 0.1131, "tasa_acierto_total": 0.8869,
        "muestra_n": 168, "muestra_integridad_dudosa": 0,
        "ventana_desde": "…", "ventana_hasta": "…",
        "zona_horaria": "America/Bogota", "advertencia_muestra": null }
    ],
    "nota": "Las tasas por hora vienen con su muestra_n. Con la muestra actual, cada hora ronda las ~170 observaciones: diferencias de varios puntos entre horas son compatibles con el azar. Una hora no es mejor por tener mejor tasa."
  },
  "requestId": "…"
}
```

#### 4.13.4 `GET /api/v1/analytics/racha3/por-dia`

Frecuencia por día calendario de Bogotá. **Si no acotás la ventana, se usan los últimos 90 días** (`dias_por_defecto`): sin ese default la respuesta crecería una fila por día para siempre.

```json
{
  "data": {
    "unidad_tasas": "fraccion_0_1",
    "zona_horaria": "America/Bogota",
    "dias_por_defecto": 90,
    "dias": [
      { "dia_col": "2026-08-21", "total": 121, "resueltas": 121,
        "directa": 63, "mg1": 30, "mg2": 15, "perdidas": 13,
        "tasa_acierto_total": 0.8926, "tasa_perdida": 0.1074,
        "muestra_n": 121, "muestra_integridad_dudosa": 0,
        "zona_horaria": "America/Bogota", "advertencia_muestra": null }
    ]
  },
  "requestId": "…"
}
```

#### 4.13.5 `GET /api/v1/analytics/racha3/distancia-actual`

Cuántas jugadas van desde la última Racha 3, **con el contexto histórico completo**. Query propio: `cotas`.

```json
{
  "data": {
    "zona_horaria": "America/Bogota",
    "cotas": [5, 10, 15, 20, 30, 50],
    "distancia": {
      "jugadas_desde_ultima": 8,
      "jugadas_sin_procesar": 0,
      "distancia_exacta": true,
      "ultima_jugada_confirmacion_id": 43036,
      "ultima_confirmacion_en": "2026-09-08T00:47:47.859Z",
      "ultima_hora_col": 19,
      "ultima_tipo_racha": "BANKER",
      "ultima_estado": "RESUELTA",
      "ultima_resultado_final": "MG2",
      "jugada_mas_reciente_id": 43083,
      "jugada_mas_reciente_en": "2026-09-08T01:13:38.612Z",
      "zona_horaria": "America/Bogota"
    },
    "bucket_actual": {
      "bucket": "6-10", "orden": 2,
      "casos_observados": 11701, "eventos": 1551,
      "tasa_empirica_condicionada": 0.1326,
      "intervalos_en_bucket": 1551,
      "frecuencia_historica": 0.3819,
      "muestra_n": 4061, "advertencia_muestra": null
    },
    "buckets": [ "… los 7 buckets …" ],
    "nota": "frecuencia_historica y tasa_empirica_condicionada son magnitudes distintas y no comparables…"
  },
  "requestId": "…"
}
```

**Devuelve los 7 buckets, no sólo el vigente.** Un número aislado ("13 %") invita exactamente a la lectura que el dominio prohíbe; con la tabla completa a la vista se ve que la tasa es prácticamente plana a partir de la sexta jugada, y que por lo tanto la distancia acumulada **no informa** mucho en este histórico.

**`distancia_exacta` y `jugadas_sin_procesar` son parte del contrato, no metadata decorativa.** `jugadas_desde_ultima` se cuenta sobre las jugadas reales, incluidas las que el incremental todavía no procesó. Si `distancia_exacta` es `false`, podría existir una Racha 3 ya ocurrida y aún no detectada dentro de ese rezago, y entonces la distancia real sería **menor** que la informada. Ocultarlo convertiría una estimación en una afirmación.

Definición explícita del hazard, porque es donde se cometen los errores:

- `casos_observados(d)` = jugadas del historial que **estuvieron** a distancia `d` de la confirmación anterior (el conjunto en riesgo). Un intervalo de largo `k` aporta un caso a cada `d` de 1..k; la cola posterior a la última confirmación también aporta, sin evento.
- `eventos(d)` = de esos casos, en cuántos la jugada fue ella misma una confirmación.
- `tasa_empirica_condicionada` = `eventos / casos_observados`.

`incluir_bloqueadas` se aplica con el **mismo valor** a la distancia y a los buckets: la distancia sólo es comparable contra ellos si se mide sobre la misma serie con la que se construyeron.

#### 4.13.6 `GET /api/v1/analytics/racha3/perdidas`

Distancia entre pérdidas (`LOSS`). Misma forma de respuesta que `/intervalos`, con `entre` forzado a `PERDIDAS`. Query propio: `metrica`, `cotas`.

Sobre el histórico: mediana **62,5 jugadas** entre pérdidas (promedio 86,25, máximo 674), n = 492 (= `#LOSS − 1`).

#### 4.13.7 `GET /api/v1/analytics/racha3/columnas/distribucion`

Longitudes de columna por tipo. Base del futuro concepto "L" (columna PLAYER/BANKER de longitud ≥ 6).

Query propio: `tipo`, `maximo` (entero 2–50, default 10 — longitudes ≥ `maximo` se agrupan en `"10+"`).

```json
{
  "data": {
    "maximo": 10,
    "columnas": [
      { "tipo": "BANKER", "longitud": "1", "orden": 1, "n": 2971,
        "frecuencia_historica": 0.2809, "truncadas": 4, "muestra_n": 10578 },
      { "tipo": "BANKER", "longitud": "10+", "orden": 10, "n": 3,
        "frecuencia_historica": 0.0003, "truncadas": 0, "muestra_n": 10578 }
    ]
  },
  "requestId": "…"
}
```

`truncadas` cuenta las columnas cuya longitud observada pudo quedar cortada por un hueco del historial. En un análisis de longitudes es exactamente el dato que no debe pasarse por alto, porque sesga hacia longitudes menores.

#### 4.13.8 `GET /api/v1/analytics/racha3/estado`

Salud del pipeline derivado. Sin parámetros.

```json
{
  "data": {
    "checkpoint_existe": true,
    "ultima_jugada_procesada": 43083,
    "ultima_jugada_procesada_en": "2026-09-08T01:13:38.612Z",
    "reproceso_desde_jugada_id": 43081,
    "checkpoint_actualizado_en": "2026-09-08T01:14:02.104Z",
    "jugadas_sin_procesar": 0,
    "jugada_mas_reciente_id": 43083,
    "jugada_mas_reciente_en": "2026-09-08T01:13:38.612Z",
    "total_jugadas": 42464,
    "total_columnas": 25417,
    "total_oportunidades": 4119,
    "oportunidades_pendientes": 0,
    "ejecucion_id": 31,
    "ejecucion_tipo": "INCREMENTAL",
    "ejecucion_estado": "OK",
    "ejecucion_error": null,
    "ejecucion_duracion_ms": 87,
    "ejecucion_en": "2026-09-08T01:14:02.104Z",
    "al_dia": true
  },
  "requestId": "…"
}
```

**Es lo que permite distinguir "no hay Racha 3 nuevas" de "el procesamiento está caído"**: sin este endpoint, desde afuera se ven igual. `al_dia: false` con `jugadas_sin_procesar` creciendo significa que el pipeline está detenido.

`al_dia` = `checkpoint_existe && jugadas_sin_procesar === 0`. Se deriva en el backend para que no lo reinvente cada cliente con un umbral distinto.

#### 4.13.9 `POST /api/v1/analytics/racha3/reprocesar`

Dispara una corrida **incremental** a pedido. Único endpoint de este recurso que escribe. Sin body, sin query. Responde **201**.

```json
{
  "data": {
    "tipo": "INCREMENTAL",
    "estado": "OK",
    "hubo_cambios": true,
    "ejecucion_id": 31,
    "desde_jugada_id": 43043,
    "hasta_jugada_id": 43083,
    "jugadas_leidas": 41,
    "columnas_afectadas": 34,
    "operaciones_afectadas": 7,
    "duracion_ms": 87,
    "error": null
  },
  "requestId": "…"
}
```

`estado` puede ser `OK`, `ERROR_PROCESO` (la función corrió y abortó su propio trabajo — p. ej. detectó una inserción retroactiva; todo se revirtió y el checkpoint no avanzó) o `NO_DISPONIBLE` (sin conexión a la base). En los dos últimos casos `error` trae el motivo. **Ninguno lanza una excepción HTTP**: la respuesta es 201 con el desenlace descrito, porque el disparo se ejecutó y su resultado es información, no un fallo de la petición.

Sin jugadas nuevas, `hubo_cambios` es `false` y no se toca ni una fila.

**No expone el rebuild**, a propósito: es destructivo (`TRUNCATE`) y dura segundos, así que queda como operación de línea de comandos (`pnpm analytics:rebuild`), donde quien la ejecuta ve lo que hace.

Autenticación: el mismo `X-Api-Key` que todo lo demás. No hay un nivel admin aparte — mismo criterio que `POST /api/v1/admin/reports` (§4.9). La concurrencia con el scheduler interno de 60 s no requiere coordinación: `analytics_racha3_incremental()` toma `pg_advisory_xact_lock(42, 3)`, así que un disparo manual y un tick simultáneos se serializan solos y el segundo encuentra el trabajo ya hecho.

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

- **`GET /api/v1/results`** (listado crudo y paginado de `jugadas` desde la base) — **sigue sin existir, pero ya no por falta de datos**: la ingesta está activa desde `Mk-Ingestion-Service` y hay ~42.500 filas. La necesidad real resultó ser evidencia estadística agregada, no un listado de jugadas crudas, y eso lo cubre `GET /api/v1/analytics/racha3/*` (§4.13). Para el contexto inmediato sigue estando la ventana en memoria de 200 jugadas (§4.3). Si algún día hace falta el listado crudo, el diseño acordado (cursor sobre `id`) está en Mk-Api.md ADR-12 — con la advertencia de que `jugadas.id` **no es contiguo**, así que el cursor debe ser `id > último ORDER BY id`, nunca `BETWEEN`.
- **Rebuild histórico de Analytics por HTTP** — deliberadamente no expuesto: es destructivo (`TRUNCATE`) y dura segundos. Se hace con `pnpm analytics:rebuild` (ver `ANALYTICS.md` §10.1). Por HTTP sólo se puede disparar el incremental (§4.13.9).
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
| `DATABASE_URL` | Sin ella, los endpoints de Analytics (§4.13) responden `503 UNAVAILABLE`. El resto de la API no depende de la base |
| `ANALYTICS_INTERVAL_MS` | Cada cuánto el backend procesa las jugadas nuevas hacia las tablas derivadas de Analytics (default 60000). No afecta a los endpoints, sí a cuán fresco está lo que devuelven — visible en `GET /api/v1/analytics/racha3/estado` (§4.13.8) |

Ver `.env.example` para la lista completa (incluye las de Telegram/Tipminer/DB, no específicas de esta capa).

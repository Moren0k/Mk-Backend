# Arquitectura — Motor de Análisis BacBo

> Refleja el estado real del código al final de la Etapa 8 (incluye el ajuste posterior `GameReceivedEvent.isHistorical`). Fuente de verdad conceptual: `INIT.md`. Este documento describe la implementación concreta.

---

## 1. Filosofía

Motor de procesamiento de eventos, no un CRUD. Todo gira alrededor de un único disparador: **llega una jugada nueva**. Cada capa tiene una responsabilidad única, y la comunicación entre módulos siempre pasa por el `DomainEventBus` — ningún coordinador conoce a otro coordinador directamente.

---

## 2. Flujo completo

```
Backend BacBo (Tipminer)
        │
        ▼ HTTP (historial inicial) / SSE (en vivo)
GameEventCollector ──────────────────────────────────────────┐
        │                                                     │
        ▼                                                     │ start()
HistoryStore.append(game)                                     │ (main.ts, después
        │ (solo si no era duplicado)                          │  de app.listen())
        ▼
   GameReceivedEvent { game, isHistorical } ─────┬──────────┬──────────────────┐
        │                                        │          │                  │
        ▼                                        ▼          ▼                  ▼
StrategyCoordinator                       OperationCoordinator  StatisticsService  EngineMetricsService
(ignora si isHistorical===true)             (actualiza activas)  (cuenta TODO,     (cuenta TODO,
        │                                                        incl. historial)  incl. historial)
        ▼
   Streak3Strategy.evaluate(context)
        │ (si detecta racha de 3, y la partida NO es histórica)
        ▼
  StrategyTriggeredEvent
        │
        ▼
 OperationCoordinator.onStrategyTriggered()
        │
        ▼
   Operation.open(signal)  ──────►  OperationOpenedEvent
        │
        ▼ (con cada GameReceivedEvent siguiente)
   Operation.update(game)  ──────►  MartingaleOneReachedEvent
                                    MartingaleTwoReachedEvent
                                    OperationWonEvent / OperationLostEvent
        │
        ▼ (todos los eventos de Operation)
 NotificationCoordinator
        │
        ▼ NotificationFactory.createForXxx(snapshot, channelType)
   Notification (channel-agnóstica)
        │
        ▼ channel.send(notification)   [fire-and-forget, nunca bloquea]
   TelegramChannel ──► Telegram Bot API
        │
        ▼ (según el resultado)
 NotificationSentEvent / NotificationFailedEvent
        │
        ▼
   EngineMetricsService (notificationsSent / notificationsFailed)
```

`EngineHealth` no participa de este flujo: es una clase de **consulta** que lee el estado actual de `HistoryStore`, `GameEventCollector`, `OperationCoordinator` y los registros de estrategias/canales cuando alguien se lo pide.

---

## 3. Capas

| Capa | Regla | Ejemplos |
|---|---|---|
| `core/` | TypeScript puro. Nunca importa `@nestjs/*`. Nunca importa de `application/` ni `infrastructure/`. | `Operation`, `Streak3Strategy`, `InMemoryHistoryStore`, `InMemoryDomainEventBus`, `Statistics`, `EngineMetrics`, `EngineErrorTracker`, todos los `DomainEvent` |
| `application/` | Orquesta. Puede depender de `core`. Nunca de `infrastructure`. | `StrategyCoordinator`, `OperationCoordinator`, `NotificationCoordinator`, `StatisticsService`, `EngineMetricsService`, `EngineHealth` |
| `infrastructure/` | Integraciones externas. Puede depender de `core` y `application`. | `GameEventCollector`, `TipminerSseClient`, `TipminerGameHistoryClient`, `TelegramChannel` |

Verificado con `grep` al cierre de la Etapa 8: cero imports de `core/` hacia `application/`/`infrastructure/`, cero `@nestjs/*` dentro de `core/`.

---

## 4. Entidades y objetos de dominio

| Concepto | Tipo | Dónde vive | Notas |
|---|---|---|---|
| `Game` | `type` | `core/history/game.type.ts` | Jugada ya ocurrida. `uuid`, `winner`, `score`, `playedAt`. |
| `HistoryStore` / `InMemoryHistoryStore` | interfaz + impl | `core/interfaces/`, `core/history/` | `RingBuffer<Game>` de 200 posiciones, oculto detrás del contrato. |
| `HistorySnapshot` | interfaz + impl | `core/interfaces/`, `core/history/` | Vista de solo lectura, congelada, que reciben las estrategias. |
| `StrategySignal` | `type` | `core/strategy/types/` | Incluye `maxMartingales` y `triggerGameUuid` (ver §8). |
| `Operation` | **clase rica (aggregate root)** | `core/operation/operation.entity.ts` | Encapsula la máquina de estados, martingalas, empates e historial interno. Nunca conoce `DomainEvent` ni el bus. |
| `OperationSnapshot` | `type` | `core/operation/types/` | Payload de todos los eventos de Operation. |
| `Notification` | `type` | `core/notification/notification.type.ts` | Channel-agnóstica: `title`, `message`, `severity`, `channel`, `metadata`. |
| `Statistics` | clase | `core/statistics/statistics.entity.ts` | Contadores incrementales O(1): totales, porcentajes, racha actual. |
| `EngineMetrics` | clase | `core/observability/engine-metrics.entity.ts` | Contadores incrementales O(1) del motor completo. |
| `EngineErrorTracker` | clase | `core/observability/engine-error-tracker.ts` | Único punto de registro del último error operativo. |

---

## 5. Coordinadores y servicios de aplicación

| Componente | Escucha | Publica | Nada más |
|---|---|---|---|
| `StrategyCoordinator` | `GameReceivedEvent` | `StrategyTriggeredEvent` | Arma el `StrategyContext`, ejecuta todas las `Strategy` registradas, nunca conoce cuáles ni cuántas. **Ignora las partidas con `isHistorical: true`** (ver §8.6): una racha ocurrida hace horas no es una oportunidad accionable. |
| `OperationCoordinator` | `StrategyTriggeredEvent`, `GameReceivedEvent` | `OperationOpenedEvent`, `MartingaleOneReachedEvent`, `MartingaleTwoReachedEvent`, `OperationWonEvent`, `OperationLostEvent` | Crea/actualiza/elimina `Operation`. Toda la lógica de negocio vive en `Operation`, no aquí. |
| `NotificationCoordinator` | Los 5 eventos de `Operation` | `NotificationSentEvent`, `NotificationFailedEvent` | Construye `Notification` vía `NotificationFactory` por cada canal habilitado y la envía sin bloquear el motor. |
| `StatisticsService` | `GameReceivedEvent` | — | Delega en `Statistics` (core). Cuenta **todas** las partidas, históricas o no: es analítica descriptiva. |
| `EngineMetricsService` | Los 9 eventos de negocio | — | Delega en `EngineMetrics` (core). |
| `EngineHealth` | (no escucha nada) | — | Clase de consulta pura: `getSnapshot()` lee el estado actual de los demás componentes. |

Todos los coordinadores con ciclo de vida (`OnModuleInit`/`OnModuleDestroy`) se suscriben/desuscriben usando la **misma referencia de handler** en ambos métodos.

---

## 6. Eventos de dominio

| Evento | Payload | Publicado por |
|---|---|---|
| `GameReceivedEvent` | `{ game: Game, isHistorical: boolean }` | `GameEventCollector` |
| `StrategyTriggeredEvent` | `StrategySignal` | `StrategyCoordinator` |
| `OperationOpenedEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `MartingaleOneReachedEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `MartingaleTwoReachedEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `OperationWonEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `OperationLostEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `NotificationSentEvent` | `{ notificationId, channel }` | `NotificationCoordinator` |
| `NotificationFailedEvent` | `{ notificationId, channel, reason }` | `NotificationCoordinator` |

Preparados para una etapa futura, sin ningún publisher todavía: `OperationOpenedEvent`... (ya implementado). Reservados sin usar: ninguno — los 5 eventos de Operation previstos desde la Etapa 4 ya están completos.

---

## 7. Dependencias entre módulos NestJS

```
AppModule
├── AppConfigModule
├── HistoryModule                    (exporta HISTORY_STORE)
├── OperationModule                  (exporta OperationCoordinator)
│     └── DomainEventBusModule, ErrorTrackingModule
├── StrategyModule                   (exporta STRATEGIES)
│     └── HistoryModule, DomainEventBusModule, ErrorTrackingModule
├── NotificationModule               (exporta NOTIFICATION_CHANNELS)
│     └── DomainEventBusModule, ErrorTrackingModule
├── StatisticsModule
│     └── DomainEventBusModule
└── ObservabilityModule              (EngineMetricsService, EngineHealth)
      └── DomainEventBusModule, HistoryModule, CollectorModule,
          OperationModule, StrategyModule, NotificationModule,
          ErrorTrackingModule
            └── CollectorModule
                  └── HistoryModule, DomainEventBusModule, ErrorTrackingModule
```

`ErrorTrackingModule` es un módulo hoja (sin imports propios) que provee el único `EngineErrorTracker`: al no depender de nada, puede ser importado por `CollectorModule`, `StrategyModule`, `OperationModule`, `NotificationModule` y `ObservabilityModule` sin crear un ciclo entre ellos.

`CollectorModule` solo es alcanzable a través de `ObservabilityModule` (necesita `GameEventCollector` para `EngineHealth`). Esto ya **no** determina cuándo arranca el collector (ver §8).

---

## 8. Decisiones arquitectónicas clave

### 8.1 `GameEventCollector.start()` explícito, no `OnModuleInit`

Se verificó empíricamente en la Etapa 8 que el orden en que NestJS invoca los `onModuleInit` de distintos módulos **no es una garantía confiable**: en una prueba real, `StatisticsModule` quedó suscrito *después* de que `GameEventCollector` ya había publicado la carga inicial de 200 partidas, a pesar de que el orden de `imports` "debía" garantizar lo contrario.

La solución: `GameEventCollector` ya no implementa `OnModuleInit`. Expone `start()`, y es `main.ts` quien lo invoca explícitamente **después** de `app.listen()` — momento en el que NestJS sí garantiza (esto también se verificó empíricamente) que absolutamente todos los `onModuleInit` de la aplicación ya terminaron. El resultado no depende de ningún orden de módulos.

### 8.2 `triggerGameId` en `Operation`

Cada `StrategySignal` incluye `triggerGameUuid` (el uuid de la partida que disparó la señal). `Operation` lo recuerda como `triggerGameId` e ignora esa partida si alguna vez le llega como actualización — sin esto, una `Operation` recién creada podría procesar como "primera jugada" la misma partida que la originó, si `OperationCoordinator` reaccionara a un `GameReceivedEvent` antes que `StrategyCoordinator` para ese mismo evento. Con este campo, el resultado es correcto sin importar el orden de los subscribers.

### 8.3 Multi-provider manual

NestJS no tiene "multi providers" nativos como Angular (dos providers bajo el mismo token se pisan, no se acumulan). `StrategyModule` y `NotificationModule` registran cada estrategia/canal como su propio provider y agrupan el arreglo con un `useFactory`. Agregar una estrategia o canal nuevo nunca toca `StrategyCoordinator` ni `NotificationCoordinator`.

### 8.4 Asincronía en notificaciones

`DomainEventBus.publish()` es síncrono. Si `NotificationCoordinator` esperara (`await`) el envío a Telegram, el motor completo (Strategy/Operation) se congelaría mientras Telegram responde o reintenta (hasta 3 intentos). Por eso el envío es *fire-and-forget*, con su propio manejo de errores, y el resultado (entregado o no) se reporta de vuelta al motor únicamente a través de `NotificationSentEvent`/`NotificationFailedEvent`.

### 8.5 Orden de un `DomainEventHandler` recorder

Nota para quien escriba tests contra el bus real: si un subscriber A (registrado antes que un recorder) publica de forma síncrona un evento anidado durante su propio manejo, el recorder verá ese evento anidado *antes* de terminar de recibir la notificación del evento externo, si el recorder se suscribió después que A. Para observar el verdadero orden de `publish()`, el recorder debe suscribirse **primero** a cada tipo de evento (ver `full-pipeline.e2e.spec.ts`).

### 8.6 `GameReceivedEvent.isHistorical`

Detectado tras el cierre de la Etapa 8, en un arranque real: la carga inicial de hasta 200 partidas podía disparar `Streak3Strategy` sobre rachas ocurridas horas atrás, abriendo `Operation` reales y enviando notificaciones reales a Telegram por patrones que ya no son accionables.

`GameReceivedEvent` ahora lleva `{ game, isHistorical }` en vez de solo `Game`. `GameEventCollector` marca `isHistorical: true` para la carga inicial y `false` para el SSE en vivo. `StrategyCoordinator` ignora por completo las partidas históricas (nunca las evalúa, nunca genera `StrategyTriggeredEvent`) — por lo tanto `OperationCoordinator` y `NotificationCoordinator` tampoco actúan sobre ellas, sin necesidad de que ellos mismos conozcan el flag. `StatisticsService` y `EngineMetricsService` sí cuentan el historial completo: son analítica descriptiva ("¿qué pasó?"), no una decisión de negocio.

---

## 9. Rendimiento (análisis, sin optimizar)

**O(1) hoy:**
- `RingBuffer.add()` — array de tamaño fijo, sin `shift()`, sin recrear arrays.
- `Statistics.recordGame()` y cada `EngineMetrics.recordXxx()` — solo incrementan contadores, nunca recorren nada.
- `Operation.update()` — comparaciones fijas + un `push()` a su propio historial (acotado a ~3 entradas).
- `Streak3Strategy.evaluate()` — `historySnapshot.getLast(3)`, nunca `getAll()`.

**O(n) hoy, con `n` acotado (no crece indefinidamente):**
- `HistoryStore.exists()`/`findByUuid()` — recorrido lineal sobre el `RingBuffer`, `n ≤ MAX_HISTORY_SIZE = 200`. Aceptable: 200 comparaciones son microsegundos, y solo se ejecuta una vez por partida entrante (~cada 35s hoy).
- `RingBuffer.getAll()` / `HistoryStore.getAll()` — construye la copia congelada, `n ≤ 200`.

**O(m) hoy, con `m` NO acotado por una constante fija:**
- `OperationCoordinator.onGameReceived()` — recorre TODAS las operaciones activas por cada partida (`m` = operaciones simultáneas). Es el único costo que crece con la carga real del sistema en vez de con una constante de diseño. Cada `operation.update()` individual sigue siendo O(1), así que el costo total es O(m), no O(m²) ni peor.
- `NotificationCoordinator.dispatch()` — O(c), `c` = canales registrados (hoy 1).

**Qué domina el consumo de memoria:**
- `RingBuffer<Game>`: 200 posiciones fijas — memoria constante, no crece nunca.
- `OperationCoordinator.activeOperations` (`Map<string, Operation>`): crece con operaciones simultáneas abiertas. Es la única estructura cuyo tamaño depende directamente de cuántas señales dispara el motor de estrategias, no de un límite de diseño.
- `Statistics`/`EngineMetrics`: memoria constante (unos pocos contadores), sin importar cuántas partidas hayan ocurrido — validado explícitamente en los tests (Etapa 8).

**¿Cuántas operaciones simultáneas soportaría razonablemente esta arquitectura?**
Cómodamente miles. Cada `Operation` es un objeto pequeño (unos pocos campos + un historial de máximo ~3 transiciones), y `operation.update()` es O(1) real. Con la cadencia actual (~1 partida cada 35s), incluso decenas de miles de operaciones activas se procesarían en microsegundos por partida — muy por debajo de cualquier presión real sobre un único proceso Node.js de un solo hilo.

**¿Qué cambiaría si hubiera miles de partidas por minuto (~16-17/s)?**
El motor en memoria (`HistoryStore`, `DomainEventBus`, los coordinadores) seguiría siendo trivial a esa tasa: cada cascada completa (historial → estrategias → operaciones → notificación) es sub-milisegundo. El cuello de botella real aparecería primero en **Telegram**: la Bot API tiene límites de tasa (~30 mensajes/segundo por bot, bastante menos por chat individual) muy por debajo de lo que el motor podría generar si muchas señales dispararan notificaciones simultáneamente — el `NotificationChannel` (no el dominio) sería la primera pieza en necesitar ajustes (una cola con límite de tasa, por ejemplo). Con volúmenes sustancialmente mayores (múltiples mesas, cientos de partidas por segundo) sí valdría la pena reconsiderar: `HistoryStore` por mesa en vez de uno global, y reemplazar el `DomainEventBus` en memoria por un broker si se necesitara escalar horizontalmente entre procesos. Nada de esto se implementó: es exactamente el tipo de optimización prematura que esta etapa pidió evitar.

---

## 10. Cómo extender

- **Nueva estrategia**: crear una clase que implemente `Strategy` en `core/strategy/strategies/`, registrarla en `StrategyModule` (providers + factory). `StrategyCoordinator` no cambia.
- **Nuevo canal de notificación**: crear una clase que implemente `NotificationChannel` en `infrastructure/`, registrarla en `NotificationModule`. `NotificationCoordinator` no cambia.
- **Nuevo evento de Operation** (si el estado lo permitiera): agregar la clase en `core/domain-events/operation/`, sumar una entrada a `EVENT_FACTORY_BY_STATE` en `operation.coordinator.ts` y un método a `NotificationFactory`.

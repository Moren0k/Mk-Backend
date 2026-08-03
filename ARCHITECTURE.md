# Arquitectura — Motor de Análisis BacBo

> Refleja el estado real del código al cierre de la Etapa 9 (notificaciones personalizadas, distribución de porcentajes, empates visibles, streakWinner, borrado de mensajes intermedios). Fuente de verdad conceptual: `INIT.md`. Este documento describe la implementación concreta.

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
   StrategyTriggeredEvent { recommendedWinner, streakWinner }
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
                                     OperationTieOccurredEvent   ← TIE: notifica, no consume martingala
                                     OperationWonEvent / OperationLostEvent
        │
        ▼ (todos los eventos de Operation)
  NotificationCoordinator
        │
        ├── dispatch() → distributionMetric.getSnapshot() → DistributionMetricValue
        │       │
        │       ▼ NotificationFactory.createForXxx(snapshot, channelType, distribution)
        │       │                                │
        │       │                                ▼ mensajes con bolas (🔵 P / 🔴 B)
        │       │                                   porcentajes inline (solo ENTRADA)
        │       │                                   línea de distribución 🔵🟡🔴 al final
        │       │
        │       ▼ channelDispatcher.dispatchToAll(buildNotification, onSent?)
        │           │
        │           ├── channel.send(notification) → SendResult { delivered, messageId }
        │           │       │
        │           │       ├── (si MG1/MG2/TIE) onSent → MessageTracker.register(opId, type, messageId)
        │           │       └── publish(NotificationSentEvent / NotificationFailedEvent)
        │           │
        │           └── (si WON/LOST) setTimeout(4s, cleanup)
        │                   │
        │                   ▼ MessageTracker.getAndClear(opId) → [MG1, MG2, TIE]
        │                   │
        │                   └── for each: channel.deleteMessage(messageId) [fire-and-forget]
        │
        ▼ Telegram Bot API
```

`EngineHealth` no participa de este flujo: es una clase de **consulta** que lee el estado actual de `HistoryStore`, `GameEventCollector`, `OperationCoordinator` y los registros de estrategias/canales cuando alguien se lo pide.

---

## 3. Capas

| Capa | Regla | Ejemplos |
|---|---|---|
| `core/` | TypeScript puro. Nunca importa `@nestjs/*`. Nunca importa de `application/` ni `infrastructure/`. | `Operation`, `Streak3Strategy`, `InMemoryHistoryStore`, `InMemoryDomainEventBus`, `Statistics`, `EngineMetrics`, `EngineErrorTracker`, todos los `DomainEvent`, `DistributionMetricValue`, `SendResult`, `MessageType` |
| `application/` | Orquesta. Puede depender de `core`. Nunca de `infrastructure`. | `StrategyCoordinator`, `OperationCoordinator`, `NotificationCoordinator`, `StatisticsService`, `EngineMetricsService`, `EngineHealth`, `DistributionMetric`, `MessageTracker`, `NotificationChannelDispatcher` |
| `infrastructure/` | Integraciones externas. Puede depender de `core` y `application`. | `GameEventCollector`, `TipminerSseClient`, `TipminerGameHistoryClient`, `TelegramChannel` |

Verificado con `grep`: cero imports de `core/` hacia `application/`/`infrastructure/`, cero `@nestjs/*` dentro de `core/`.

---

## 4. Entidades y objetos de dominio

| Concepto | Tipo | Dónde vive | Notas |
|---|---|---|---|
| `Game` | `type` | `core/history/game.type.ts` | Jugada ya ocurrida. `uuid`, `winner`, `score`, `playedAt`. |
| `HistoryStore` / `InMemoryHistoryStore` | interfaz + impl | `core/interfaces/`, `core/history/` | `RingBuffer<Game>` de 200 posiciones, oculto detrás del contrato. |
| `HistorySnapshot` | interfaz + impl | `core/interfaces/`, `core/history/` | Vista de solo lectura, congelada, que reciben las estrategias. |
| `StrategySignal` | `type` | `core/strategy/types/` | Incluye `recommendedWinner`, `streakWinner`, `maxMartingales` y `triggerGameUuid`. `streakWinner` es el ganador de la racha (el que salió 3+ veces), `recommendedWinner` es la apuesta (el opuesto). |
| `Operation` | **clase rica (aggregate root)** | `core/operation/operation.entity.ts` | Encapsula la máquina de estados, martingalas, empates e historial interno. Reporta `tieOccurred` sin cambiar estado. Nunca conoce `DomainEvent` ni el bus. |
| `OperationSnapshot` | `type` | `core/operation/types/` | Payload de todos los eventos de Operation. Incluye `streakWinner`. |
| `OperationUpdateResult` | `type` | `core/operation/types/` | Reporta `stateChanged`, `tieOccurred`, `completed`, `transition`, `snapshot`. |
| `Notification` | `type` | `core/notification/notification.type.ts` | Channel-agnóstica: `title`, `message`, `severity`, `channel`, `metadata`. |
| `SendResult` | `type` | `core/notification/types/send-result.type.ts` | `{ delivered: boolean; messageId?: number }` — retornado por `NotificationChannel.send()`. |
| `MessageType` | `enum` | `core/notification/types/message-type.enum.ts` | `ENTRY, MG1, MG2, TIE, WON, LOST` — usado por `MessageTracker`. |
| `DistributionMetricValue` | `type` | `core/metrics/types/` | `{ playerPct, tiePct, bankerPct, totalGames }` — cálculo pull-based sobre HistoryStore. |
| `Statistics` | clase | `core/statistics/statistics.entity.ts` | Contadores incrementales O(1): totales, porcentajes, racha actual. |
| `EngineMetrics` | clase | `core/observability/engine-metrics.entity.ts` | Contadores incrementales O(1) del motor completo. |
| `EngineErrorTracker` | clase | `core/observability/engine-error-tracker.ts` | Único punto de registro del último error operativo. |

---

## 5. Coordinadores, servicios y dispatchers

| Componente | Escucha | Publica | Nada más |
|---|---|---|---|
| `StrategyCoordinator` | `GameReceivedEvent` | `StrategyTriggeredEvent` | Arma el `StrategyContext`, ejecuta todas las `Strategy` registradas. **Ignora `isHistorical: true`**. |
| `OperationCoordinator` | `StrategyTriggeredEvent`, `GameReceivedEvent` | `OperationOpenedEvent`, `MartingaleOneReachedEvent`, `MartingaleTwoReachedEvent`, `OperationTieOccurredEvent`, `OperationWonEvent`, `OperationLostEvent` | Crea/actualiza/elimina `Operation`. Publica `OperationTieOccurredEvent` cuando `result.tieOccurred`. |
| `NotificationCoordinator` | Los 6 eventos de `Operation` | `NotificationSentEvent`, `NotificationFailedEvent` | Construye `Notification` vía `NotificationFactory`, delega envío a `NotificationChannelDispatcher`, registra messageIds en `MessageTracker` para mensajes intermedios (MG1/MG2/TIE), programa cleanup con `setTimeout(4s)` al cerrar operación. |
| `NotificationChannelDispatcher` | (uso interno) | `NotificationSentEvent`, `NotificationFailedEvent` | Envía una `Notification` a cada canal habilitado. Acepta callback opcional `onSent` para que el coordinator registre messageIds. Compartido con `ReportNotificationCoordinator`. |
| `DistributionMetric` | (ninguno — pull-based) | — | `@Injectable()`. Lee `HistoryStore.getAll()`, calcula distribución P/T/B. `getSnapshot()` → `DistributionMetricValue`. |
| `MessageTracker` | (ninguno — pasivo) | — | `@Injectable()`. `Map<operationId, TrackedMessage[]>`. `register()`, `getAndClear()`. Guard `MAX_ENTRIES = 100` con evicción FIFO. |
| `StatisticsService` | `GameReceivedEvent` | — | Delega en `Statistics` (core). Cuenta **todas** las partidas. |
| `EngineMetricsService` | Los 10 eventos de negocio | — | Delega en `EngineMetrics` (core). |
| `EngineHealth` | (no escucha nada) | — | Clase de consulta pura. |

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
| `OperationTieOccurredEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `OperationWonEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `OperationLostEvent` | `OperationSnapshot` | `OperationCoordinator` |
| `NotificationSentEvent` | `{ notificationId, channel }` | `NotificationChannelDispatcher` |
| `NotificationFailedEvent` | `{ notificationId, channel, reason }` | `NotificationChannelDispatcher` |

El evento `OperationTieOccurredEvent` se introdujo en la Etapa 9: un TIE nunca cambia el estado de la operación ni consume martingala, pero ahora **sí notifica** al usuario que ocurrió un empate. La entidad `Operation` reporta `tieOccurred: true` en `OperationUpdateResult`; `OperationCoordinator` publica el evento; `NotificationCoordinator` lo escucha y envía la notificación. La notificación de empate usa el mismo formato con bolas (🔵 P / 🔴 B) que las demás.

---

## 7. Dependencias entre módulos NestJS

```
AppModule
├── AppConfigModule
├── HistoryModule                    (exporta HISTORY_STORE)
├── OperationModule                  (exporta OperationCoordinator)
│     └── DomainEventBusModule, ErrorTrackingModule
├── StrategyModule                   (exporta STRATEGIES)
│     └── HistoryModule, DomainEventBusModule, ErrorTrackingModule, OperationModule
├── NotificationModule               (exporta NOTIFICATION_CHANNELS)
│     └── DomainEventBusModule, ErrorTrackingModule, DistributionMetricModule
│           └── DistributionMetricModule
│                 └── HistoryModule
├── DistributionMetricModule         (exporta DistributionMetric)
│     └── HistoryModule
├── StatisticsModule
│     └── DomainEventBusModule
└── ObservabilityModule              (EngineMetricsService, EngineHealth)
      └── DomainEventBusModule, HistoryModule, CollectorModule,
          OperationModule, StrategyModule, NotificationModule,
          ErrorTrackingModule
            └── CollectorModule
                  └── HistoryModule, DomainEventBusModule, ErrorTrackingModule
```

`ErrorTrackingModule` es un módulo hoja (sin imports propios) que provee el único `EngineErrorTracker`.

---

## 8. Decisiones arquitectónicas clave

### 8.1 `GameEventCollector.start()` explícito, no `OnModuleInit`

Se verificó empíricamente que el orden en que NestJS invoca los `onModuleInit` de distintos módulos **no es una garantía confiable**. `GameEventCollector` expone `start()`, y `main.ts` lo invoca después de `app.listen()`.

### 8.2 `triggerGameId` en `Operation`

Cada `StrategySignal` incluye `triggerGameUuid`. `Operation` lo recuerda como `triggerGameId` e ignora esa partida si llega como actualización. El resultado es correcto sin importar el orden de los subscribers.

### 8.3 Multi-provider manual

NestJS no acumula providers bajo el mismo token. `StrategyModule` y `NotificationModule` registran cada estrategia/canal y agrupan con `useFactory`. Agregar una estrategia o canal nunca toca los coordinadores.

### 8.4 Asincronía en notificaciones

`DomainEventBus.publish()` es síncrono. El envío a Telegram es *fire-and-forget*, con su propio manejo de errores. El resultado se reporta vía `NotificationSentEvent`/`NotificationFailedEvent`.

### 8.5 `GameReceivedEvent.isHistorical`

La carga inicial de hasta 200 partidas marca `isHistorical: true`. `StrategyCoordinator` las ignora. `StatisticsService` y `EngineMetricsService` sí las cuentan.

### 8.6 `DistributionMetric` pull-based

`DistributionMetric.getSnapshot()` lee `HistoryStore.getAll()` bajo demanda, sin suscribirse a eventos. Esto evita depender del orden de suscripción del `DomainEventBus`. El juego ya está en `HistoryStore` antes de que cualquier subscriber se ejecute (ver §9).

### 8.7 `streakWinner` en `StrategySignal`

Cada señal ahora incluye tanto `recommendedWinner` (a qué apostar — el opuesto de la racha) como `streakWinner` (el ganador de la racha — el que salió 3+ veces consecutivas). Esto permite que las notificaciones muestren `"INGRESAR DESPUES DE :BANKER 40.00%"` (streakWinner) y `"APUESTA EN: PLAYER (48.50%)"` (recommendedWinner) de forma independiente.

### 8.8 `tieOccurred` en `OperationUpdateResult`

Un TIE nunca cambia el estado de la operación ni consume martingala. Pero ahora `Operation.update()` reporta `tieOccurred: true`, y `OperationCoordinator` publica `OperationTieOccurredEvent`. La notificación de empate informa al usuario sin modificar la máquina de estados.

### 8.9 Notificaciones con bolas (🔵 P / 🔴 B)

Los mensajes de Telegram usan indicadores visuales con emojis en vez de texto: `🔵 P` para PLAYER, `🔴 B` para BANKER. La línea de distribución (`🔵 xx% 🟡 xx% 🔴 xx%`) se muestra al final de todas las notificaciones.

### 8.10 `NotificationChannelDispatcher` extraído

La lógica de envío y reporte (`sendAndReport`) se extrajo de `NotificationCoordinator` a `NotificationChannelDispatcher`. Esto permite que `ReportNotificationCoordinator` (reportes horario/diario) reutilice exactamente la misma lógica sin duplicarla. El dispatcher acepta un callback opcional `onSent` para que el coordinator de notificaciones registre messageIds en el `MessageTracker`.

### 8.11 `SendResult` y `deleteMessage` en `NotificationChannel`

`NotificationChannel.send()` ahora retorna `SendResult` en vez de `boolean`. El campo `messageId` permite que `MessageTracker` registre el identificador de Telegram para borrado posterior. Se agregó `deleteMessage(messageId): Promise<boolean>` al contrato del canal — sin reintentos, fire-and-forget.

### 8.12 Sistema de borrado de mensajes intermedios

Cuando una operación cierra (WON/LOST), el `NotificationCoordinator`:
1. Envía la notificación final
2. Programa un `setTimeout(4000ms)` para dar tiempo al usuario de leer los mensajes intermedios
3. Al disparar el timer, recupera del `MessageTracker` los messageIds de MG1, MG2 y TIE
4. Los borra uno por uno vía `channel.deleteMessage()`
5. ENTRY y WON/LOST nunca se registran en el tracker — nunca se borran

La constante `MESSAGE_CLEANUP_DELAY_MS = 4000` está documentada como mayor que `MAX_SEND_ATTEMPTS × RETRY_DELAY_MS + margen`. `OnModuleDestroy` limpia todos los timers pendientes. El borrado fallido solo genera `logger.warn()`, nunca `NotificationFailedEvent`.

---

## 9. Flujo de datos — Pull-based y race conditions

### 9.1 `DistributionMetric` pull-based

`GameEventCollector.storeGame()` inserta el juego en `HistoryStore` (línea 144) **antes** de publicar `GameReceivedEvent` (línea 147). Cuando cualquier subscriber del bus ejecuta su handler, el juego ya está en `HistoryStore`. `DistributionMetric.getSnapshot()` llama a `historyStore.getAll()` y ve el dato actualizado sin importar el orden de suscripción.

### 9.2 `MessageTracker` y `onSent`

El callback `onSent` se ejecuta dentro de `.then()` del `channel.send()`, que es un microtask. El `setTimeout(4000)` es un macrotask. Los microtasks se ejecutan antes que los macrotasks en el event loop de Node.js. Por lo tanto, cuando el cleanup dispara a los 4 segundos, todos los `onSent` de mensajes intermedios ya completaron y registraron sus messageIds. Los mensajes intermedios ocurren segundos/minutos antes del cierre, así que este timing está garantizado.

---

## 10. Rendimiento

**O(1) hoy:**
- `RingBuffer.add()` — array de tamaño fijo, sin `shift()`.
- `Statistics.recordGame()` y `EngineMetrics.recordXxx()` — solo incrementan contadores.
- `Operation.update()` — comparaciones fijas + `push()` a historial acotado (~3 entradas).
- `MessageTracker.register()` — `Map.set()` + `Array.push()`.
- `MessageTracker.getAndClear()` — `Map.get()` + `Map.delete()`.

**O(n) hoy, con `n ≤ 200`:**
- `DistributionMetric.getSnapshot()` — itera los últimos 200 juegos una sola vez por `dispatch()`. ~450 operaciones totales, < 50μs.
- `RingBuffer.getAll()` — copia congelada del buffer.

**O(m) hoy:**
- `OperationCoordinator.onGameReceived()` — recorre todas las operaciones activas por partida.

**Cleanup de mensajes**: O(N) con N ≤ 3 mensajes a borrar. Sin impacto en el motor (asíncrono, 4s después del evento).

---

## 11. Formato de notificaciones

Todos los mensajes comparten:
- Título vacío (el contenido del body es auto-contenido con sus propios encabezados emoji)
- Línea de distribución al final: `🔵 xx%  🟡 xx%  🔴 xx%`
- Formato MarkdownV2 escapado automáticamente por `TelegramChannel`

### Mensajes

**🚨 ENTRADA**:
```
🚨 NUEVA ENTRADA 🚨
🎯 JUEGO: Bac Bo - Evolution
📊 PATRON: streak-3
💣 INGRESAR DESPUES DE :🔴 B
🔥APUESTA EN: 🔵 P
🔁 MARTINGALAS MAXIMO: 2
🔵 48.50%  🟡 12.00%  🔴 39.50%
```

**🔁 MG1 / MG2**:
```
🔁 MARTINGALA 1
📊 PATRON: streak-3
🔥 DOBLA TU APUESTA ANTERIOR AL: 🔵 P
🔵 48.50%  🟡 12.00%  🔴 39.50%
```

**🟰 EMPATE**:
```
🟰 EMPATE 🟰
📊 PATRON: streak-3
🔥 APUESTA LO ANTERIOR AL: 🔵 P
💸 ESTA GANAREMOS 💸
🔵 48.50%  🟡 12.00%  🔴 39.50%
```

**✅ GANADA**:
```
✅ OPERACION GANADA ✅
📊 PATRON: streak-3
🏆 VICTORIA EN: PLAYER
🔁 MARTINGALAS FINAL: 1
💸 VAMOS POR MAS 💸
🔵 48.50%  🟡 12.00%  🔴 39.50%
```

**❌ PERDIDA**:
```
❌ OPERACION PERDIDA ❌
📊 PATRON: streak-3
☠️ DERROTA: 🔵 P
🔁 MARTINGALAS FINAL: 2
🧊 MENTE FRIA, NOS RECUPERAMOS EN LA PROXIMA
🔵 48.50%  🟡 12.00%  🔴 39.50%
```

---

## 12. Cómo extender

- **Nueva estrategia**: crear una clase que implemente `Strategy` en `core/strategy/strategies/`, registrarla en `StrategyModule` (providers + factory). `StrategyCoordinator` no cambia. Si la estrategia quiere exponer información adicional en `StrategySignal`, agregar el campo al tipo y usarlo en `NotificationFactory`.
- **Nuevo canal de notificación**: crear una clase que implemente `NotificationChannel` (incluyendo `deleteMessage`) en `infrastructure/`, registrarla en `NotificationModule`. `NotificationCoordinator` no cambia.
- **Nueva métrica**: crear una clase concreta (sin interfaz) en `application/metrics/`, inyectarla donde se necesite. Cuando existan 3+ métricas con 1+ consumidor polimórfico, extraer `Metric<T>` interface y `MetricsCoordinator`.
- **Nuevo evento de Operation**: agregar la clase en `core/domain-events/operation/`, actualizar `OperationCoordinator` (publicar el evento), agregar suscripción en `NotificationCoordinator` y método en `NotificationFactory`.
- **Nuevo tipo de notificación**: agregar método en `NotificationFactory` siguiendo el patrón existente (recibe `snapshot`, `channel`, `distribution?`). Usar `formatWinnerBall()` para bolas y `appendDistribution()` para la línea de porcentajes.

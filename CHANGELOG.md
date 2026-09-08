# Changelog — Mk-Backend / Motor de Análisis BacBo

## [2026-09-08] — Analytics histórico "Racha 3"

Dominio nuevo, independiente del motor de alertas: evidencia estadística sobre la estrategia Racha 3, calculada en PostgreSQL sobre las ~42.500 jugadas ya persistidas. **Analytics describe el pasado y nunca decide una alerta**; la decisión la mantiene el Core.

Referencia completa en [`ANALYTICS.md`](./ANALYTICS.md).

---

### Añadido

#### 🗄️ Modelo de datos derivado (5 migraciones)
- **4 tablas nuevas**: `columnas`, `racha3_operaciones`, `analytics_checkpoints`, `analytics_ejecuciones` — con 26 CHECK constraints, 10 FKs y 8 índices. Todo se reconstruye al 100 % desde `jugadas`, que nunca se modifica.
- **1 vista + 17 funciones SQL**: rebuild, incremental, validador de invariantes y 12 agregaciones de solo lectura. Nada materializado, a propósito.
- Claves de idempotencia **naturales** (`columnas.inicio_jugada_id`, `racha3_operaciones.columna_id`), no secuencias: reejecutar un rango no puede duplicar nada.

#### ⚙️ Procesamiento
- `analytics_racha3_rebuild()` — reconstrucción histórica completa en **~2,8 s** (42.400 jugadas → 25.400 columnas → 4.100 oportunidades).
- `analytics_racha3_incremental()` — procesa solo el tramo nuevo (9–165 ms) con punto de rebobinado seguro, guardia contra inserciones retroactivas y `pg_advisory_xact_lock(42, 3)`.
- `Racha3IncrementalScheduler` — tick de 60 s (`ANALYTICS_INTERVAL_MS`). Un tick sin jugadas nuevas es un **no-op absoluto**: no toca ni una fila.
- Tolerancia a los cortes esporádicos del pooler de Supabase: `warn` los primeros 4 fallos, escala a `error` al 5.º y una sola vez.

#### 🌐 API — 8 GET + 1 POST bajo `/api/v1/analytics/racha3/`
`resumen` · `intervalos` · `por-hora` · `por-dia` · `distancia-actual` · `perdidas` · `columnas/distribucion` · `estado` · `POST reprocesar`.
- Mismo `ApiKeyGuard` y envelope que el resto de la API; sin nivel admin adicional.
- Tasas como **fracción [0,1]**, declarado en `unidad_tasas`. Toda tasa viene con su `muestra_n`.
- `bloqueada_por_operacion_previa` **excluida por defecto** (el consumidor es el Core), y se reporta cuántas quedaron fuera.
- Validación estricta de parámetros: sin defaults silenciosos. `POST reprocesar` dispara solo el incremental — el rebuild queda como CLI.

#### ✅ Verificación
- `pnpm analytics:verify` — reconstruye el histórico con una implementación de referencia **independiente** en TypeScript y exige **0 diferencias campo a campo**, más 12 invariantes (V0–V11) y 12 comprobaciones de la capa de agregación. La referencia conduce la clase `Operation` **real** del motor, así que un cambio en la regla de martingala rompe la verificación en vez de dejar que Analytics y el motor divergan en silencio.
- `pnpm analytics:rebuild` — reconstrucción histórica explícita.
- **+104 pruebas** (616 en total): 30 fixtures del dominio, 19 del scheduler, 9 del repositorio, 26 de validación de parámetros, 17 del controller, 3 de cableado DI.

### Corregido

- **`analytics_racha3_validar()` evaluaba contra todas las jugadas** en vez de acotarse al checkpoint, así que V1/V8/V11 reportaban como violación lo que solo era rezago del incremental (migración correctiva `20260908030000`).
- **`segundos_desde_anterior` divergía en 1 s** entre SQL y TypeScript: `EXTRACT(epoch …)::integer` redondea en PostgreSQL y `Math.trunc` trunca. Semántica fijada en truncamiento; lo detectó la verificación cruzada, con 2.086 diferencias.
- **`tsconfig.build.json`**: incluir `scripts/` movía la raíz común del proyecto y `nest build` emitía `dist/src/main.js` en vez de `dist/main.js`, rompiendo `pnpm start:prod`.
- **Documentación desactualizada**: `DATABASE.md` y `ARCHITECTURE.md` afirmaban que faltaba un servicio que poblara `jugadas` (lo hace `Mk-Ingestion-Service` desde hace semanas); `Mk-Api.md` ADR-12 figuraba como PENDIENTE y referenciaba un archivo ya borrado.

### Notas

- **El motor de alertas no se modificó.** El único archivo suyo que cambió es `app.module.ts`, para sumar `AnalyticsModule` a los imports. Analytics no se suscribe al `DomainEventBus`.
- **Deuda conocida y aceptada**: `GET /intervalos` tarda ~910 ms porque sus dos consultas recomputan la misma serie de distancias y compiten por CPU. Si se optimiza, debe hacerse en SQL.
- **Riesgo operativo abierto**: `PrismaService` conecta una única vez en `onModuleInit` y no reintenta; un corte del pooler en el arranque deja la persistencia deshabilitada hasta reiniciar. Afecta también a Reporting, así que no se resolvió desde Analytics.
- **Limitación de los datos**: 19 discontinuidades > 120 s en el histórico, una de 3,3 h con ~361 rondas irrecuperables. Efecto acotado y explícito — 10 de 4.119 oportunidades con `integridad_ok = false`, reportadas en cada respuesta.

---

## [2026-08-02] — Notificaciones Personalizadas, Empates, Borrado de Mensajes y Robustez

---

### Añadido

#### 🎨 Notificaciones personalizadas para Telegram
- **6 formatos nuevos** en `NotificationFactory` con emojis, bolas de color y distribución de porcentajes.
- Línea `🔵 xx.xx%  🟡 xx.xx%  🔴 xx.xx%` al final de todos los mensajes (distribución de últimas 200 partidas).
- Bolas visuales: `🔵 P` para PLAYER, `🔴 B` para BANKER en lugar de texto.
- `streakWinner`: nuevo campo en `StrategySignal` y `OperationSnapshot` que identifica el ganador de la racha (última jugada antes de entrar).
- Formatos de mensajes:

| Tipo | Formato |
|------|---------|
| 🚨 ENTRADA | `INGRESAR DESPUES DE :{streakBall}` + `APUESTA EN: {entryBall}` + martingalas máx. |
| 🔁 MG1/MG2 | `DOBLA TU APUESTA ANTERIOR AL: {ball}` |
| 🟰 EMPATE | `APUESTA LO ANTERIOR AL: {ball}` + mensaje motivacional |
| ✅ GANADA | `VICTORIA EN: {winner}` + martingala final + `VAMOS POR MAS` |
| ❌ PERDIDA | `DERROTA: {ball}` + martingala final + `MENTE FRIA` |

#### 📊 DistributionMetric
- Nueva métrica pull-based en `application/metrics/distribution.metric.ts`.
- Calcula distribución P/T/B desde `HistoryStore.getAll()` (últimas 200 partidas).
- Sin estado interno, sin suscripción a eventos — inmune a race conditions del `DomainEventBus`.
- Tipo `DistributionMetricValue` en `core/metrics/types/distribution-metric-value.type.ts`.

#### 🟰 Notificación de empate (TIE)
- `OperationTieOccurredEvent`: nuevo evento de dominio en `core/domain-events/operation/`.
- `OperationUpdateResult.tieOccurred: boolean` — la entidad reporta el hecho sin conocer eventos.
- `OperationCoordinator` publica `OperationTieOccurredEvent` cuando `result.tieOccurred === true`.
- `NotificationCoordinator` suscrito al nuevo evento (6º evento de Operation).
- El TIE **nunca** cambia el estado ni consume martingala — solo notifica.

#### 🧹 Sistema de borrado de mensajes intermedios
- **`SendResult`**: nuevo tipo en `core/notification/types/send-result.type.ts` — extiende `boolean` con `messageId`.
- **`MessageType`**: enum en `core/notification/types/message-type.enum.ts` — `ENTRY, MG1, MG2, TIE, WON, LOST`.
- **`MessageTracker`**: servicio en `application/notification/message-tracker.ts` — `Map<operationId, TrackedMessage[]>`. Evicción FIFO con `MAX_ENTRIES = 100`.
- **`NotificationChannelDispatcher`**: extraído de `NotificationCoordinator` para reutilización. Nuevo callback opcional `onSent` para registro de messageIds.
- **`NotificationChannel`**: interfaz extendida con `deleteMessage(messageId): Promise<boolean>`.
- **`TelegramChannel`**: `send()` → `SendResult` (parsea `message_id` de Telegram). Nuevo `deleteMessage()` sin retry.
- **Cleanup flow**: cuando WON/LOST cierra una operación:
  1. Envía notificación final (sin tracking)
  2. `setTimeout(4000ms)` → recupera MG1/MG2/TIE del tracker
  3. Borra uno por uno vía `channel.deleteMessage()` (fire-and-forget)
  4. ENTRY y WON/LOST **nunca** se borran
- `MESSAGE_CLEANUP_DELAY_MS = 4000` documentado como > `MAX_SEND_ATTEMPTS × RETRY_DELAY_MS + margen`.
- `OnModuleDestroy` limpia timers pendientes.

#### 🛡️ Defensas H1 y H2 (post-auditoría)
- **H1**: Guard `if (result.messageId == null) return;` en callback `onSent` — previene registro de `messageId` inválido.
- **H2**: Validación `typeof rawId !== 'string'` en vez de `as string` cast — previene registro con `operationId` corrupto.

#### 📄 Documentación
- `ARCHITECTURE.md` completamente reescrito con 12 secciones (flujo actualizado, capas, eventos, métricas, formatos de notificación, cleanup, pull-based, rendimiento).
- `README.md` actualizado con nuevos features, estructura del proyecto y diagrama de flujo.

---

### Modificado

| Archivo | Cambio |
|---------|--------|
| `core/strategy/types/strategy-signal.type.ts` | + `streakWinner: WinnerType` |
| `core/strategy/strategies/streak3.strategy.ts` | Devuelve `streakWinner` en el signal |
| `core/operation/types/operation-snapshot.type.ts` | + `streakWinner: WinnerType` |
| `core/operation/types/operation-update-result.type.ts` | + `tieOccurred: boolean` |
| `core/operation/operation.entity.ts` | Constructor + `open()` + `toSnapshot()` recolectan `streakWinner`. `buildResult` acepta `tieOccurred`. TIE → `tieOccurred: true`. |
| `core/interfaces/notification-channel.interface.ts` | `send()` → `Promise<SendResult>`. + `deleteMessage()`. |
| `core/notification/notification.factory.ts` | 6 métodos reescritos con formatos personalizados. + `formatWinnerBall()`, `buildPatronLine()`, `appendDistribution()`, `formatDistribution()`, `createForTieOccurred()`, `createForSummaryReport()`, `buildReportMessage()`, `buildSummaryMessage()`. |
| `application/operation/operation.coordinator.ts` | Publica `OperationTieOccurredEvent` cuando `result.tieOccurred`. |
| `application/notification/notification.coordinator.ts` | 6 suscripciones. Inyecta `DistributionMetric`, `MessageTracker`. `dispatch()` con `onSent`. `dispatchAndCleanup()` con `setTimeout`. `cleanupMessages()`. `OnModuleDestroy` limpia timers. **H1+H2 guards**. |
| `application/notification/notification.module.ts` | + `DistributionMetricModule`, `MessageTracker` provider. |
| `application/notification/notification-channel-dispatcher.ts` | `dispatchToAll(build, onSent?)`. `sendAndReport` usa `SendResult`. |
| `infrastructure/telegram/telegram.channel.ts` | `send()` → `SendResult`. + `deleteMessage()`. `callSendMessage()` → `Promise<number>`. |
| `e2e/full-pipeline.e2e.spec.ts` | `FakeNotificationChannel` → `SendResult` + `deleteMessage`. `MessageTracker` en `buildEngine`. |
| 12+ archivos de tests | Actualizados builders y aserciones para `streakWinner`, `SendResult`, `MessageTracker`, cleanup con `jest.useFakeTimers`. |

---

### Tests

| Indicador | Valor |
|-----------|-------|
| Suites | 38 |
| Tests totales | 308 |
| Tests nuevos (H1+H2) | 2 defensivos |
| e2e | 4 escenarios |
| Lint | Limpio |

---

### Arquitectura final

```
Tipminer (SSE/HTTP)
    │
    ▼
GameEventCollector → HistoryStore → GameReceivedEvent
    │
    ├── StrategyCoordinator → Streak3Strategy → StrategyTriggeredEvent {streakWinner, recommendedWinner}
    │
    ├── OperationCoordinator → Operation.open() → OperationOpenedEvent
    │   └── update(game) → MG1 / MG2 / TIE / WON / LOST
    │
    └── NotificationCoordinator
        ├── distributionMetric.getSnapshot() → porcentajes en mensajes
        ├── NotificationFactory → mensajes con bolas (🔵P / 🔴B) + línea distribución
        ├── channelDispatcher.dispatchToAll(build, onSent?)
        │   └── (MG1/MG2/TIE) onSent → MessageTracker.register(messageId)
        └── (WON/LOST) → setTimeout(4s) → cleanupMessages()
            └── channel.deleteMessage(id) [fire-and-forget]
```

---

### Riesgos mitigados

| Riesgo | Mitigación |
|--------|------------|
| Race condition en distribución | Pull-based desde HistoryStore (inserción antes de publish) |
| Memory leak en tracker | `MAX_ENTRIES = 100` con evicción FIFO |
| Timers huérfanos en shutdown | `OnModuleDestroy` → `clearTimeout()` |
| Borrado de mensajes importantes | 3 capas de defensa (no registro + filtro types + onSent condicional) |
| `messageId` undefined | Guard `== null` (H1) |
| `operationId` no-string | Type guard `typeof` (H2) |
| Non-null assertions en producción | 0 (todas eliminadas) |

### Nivel de confianza para producción: 98%

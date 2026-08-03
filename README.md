# Mk-Backend — Motor de Análisis BacBo

Motor de procesamiento de eventos en tiempo real que analiza las jugadas de **BacBo** (Evolution, vía [Tipminer](https://tipminer.com)), detecta patrones de racha, simula operaciones de apuesta con martingala y notifica los resultados por Telegram.

No es un CRUD: todo el sistema gira alrededor de un único disparador — **llega una jugada nueva** — y se comunica internamente mediante un bus de eventos de dominio, sin que ningún componente conozca a otro directamente.

Para el detalle completo de la arquitectura (capas, decisiones de diseño, análisis de rendimiento, formato de notificaciones) ver [`ARCHITECTURE.md`](./ARCHITECTURE.md). Para el contrato de la API de Tipminer, ver [`API.MD`](./API.MD).

## Qué hace

1. Escucha las jugadas de BacBo en vivo (SSE) y carga un historial inicial (HTTP).
2. Evalúa estrategias sobre ese historial — hoy, `Streak3Strategy`: cuando una racha de 3 resultados iguales (PLAYER o BANKER) aparece, recomienda apostar al resultado opuesto.
3. Abre una operación simulada con hasta 2 pasos de martingala (MG1, MG2) y la sigue hasta que gana o pierde.
4. **Notifica cada evento relevante por Telegram** con formato personalizado:
   - 🚨 Entrada con la última jugada de la racha (`streakWinner`) y la apuesta recomendada
   - 🔁 Martingala 1 y 2 con indicador de bola (🔵 = PLAYER, 🔴 = BANKER)
   - 🟰 Empate (TIE) — visible pero no consume martingala
   - ✅ Victoria o ❌ Derrota con resumen final
   - Todos los mensajes incluyen la distribución de las últimas 200 partidas (`🔵 xx% 🟡 xx% 🔴 xx%`)
5. **Limpia automáticamente los mensajes intermedios** (MG1, MG2, TIE) 4 segundos después de que la operación cierra, dejando solo la entrada y el resultado final visibles en Telegram.
6. Lleva estadísticas y métricas del motor completo, incluyendo el historial cargado al arrancar.

**Salvaguardas del motor de estrategias:**
- Nunca hay dos operaciones activas simultáneas para la misma estrategia (`StrategyExecutionGuard` / `ActiveOperationRegistry`).
- Una misma racha nunca genera más de una señal, sin importar cuánto se extienda ni si la operación anterior ya se resolvió — solo una racha nueva (cortada por un TIE o un cambio de ganador) vuelve a habilitar la señal (`StrategyRuntimeState`).
- Los TIE notifican al usuario pero nunca cambian el estado de la operación ni consumen martingala.

## Requisitos

- Node.js >=22 (usado en desarrollo: v24; ver `engines` en `package.json`)
- pnpm

Por ahora el motor corre en local (en tu máquina). Cuando haya un VPS
disponible se documenta acá mismo cómo desplegarlo.

## Ejecución local

```bash
pnpm install
cp .env.example .env   # completar TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID
pnpm start:dev
```

### Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP del servidor (Fastify). Default `3000`. |
| `ADMIN_PASSWORD` | Contraseña del endpoint `POST /admin/commands`. Se hashea al arrancar; vacía = endpoint deshabilitado. |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram (se obtiene con `@BotFather`). |
| `TELEGRAM_CHAT_ID` | Id del chat/grupo donde el bot envía las alertas. |
| `TIPMINER_BASE_URL` | Base de la API pública de Tipminer. Trae un valor por defecto. |
| `TIPMINER_PROVIDER_ID` | uuid de la mesa Bac Bo en Tipminer. Trae un valor por defecto. |
| `TIPMINER_TIMEZONE` | Timezone usada al pedir el historial. Opcional. |
| `TIPMINER_API_KEY` | Reservado para cuando la API deje de ser pública; hoy no se usa. |

### Scripts

| Comando | Qué hace |
|---|---|
| `pnpm start:dev` | Levanta el servidor en modo watch. |
| `pnpm build` | Compila a `dist/`. |
| `pnpm start:prod` | Corre el build compilado (`node dist/main.js`). |
| `pnpm test` | Corre la suite de tests (Jest). |
| `pnpm lint` | ESLint + Prettier. |

## Flujo del sistema

```
Tipminer (SSE/HTTP)
    │
    ▼
GameEventCollector → HistoryStore → GameReceivedEvent
    │
    ├── StrategyCoordinator → Streak3Strategy → StrategyTriggeredEvent
    │                                                        │
    │                                              (recommendedWinner + streakWinner)
    │                                                        │
    ├── OperationCoordinator → Operation.open() → OperationOpenedEvent
    │   └── update(game) → MG1 / MG2 / TIE / WON / LOST
    │                                                        │
    └── NotificationCoordinator
        ├── distributionMetric.getSnapshot() → porcentajes
        ├── NotificationFactory → mensajes con bolas (🔵P / 🔴B)
        ├── channelDispatcher.dispatchToAll(send, onSent?)
        │   └── (MG1/MG2/TIE) → MessageTracker.register(messageId)
        └── (WON/LOST) → setTimeout(4s) → borrar MG1/MG2/TIE
            └── channel.deleteMessage(messageId) [fire-and-forget]
```

## Estructura del proyecto

```
src/
├── core/
│   ├── constants/          Tokens DI, MAX_HISTORY_SIZE
│   ├── domain-events/      Eventos de dominio (10 eventos)
│   ├── enums/              WinnerType, OperationState, etc.
│   ├── history/            RingBuffer, Game, InMemoryHistoryStore
│   ├── interfaces/         HistoryStore, HistorySnapshot, NotificationChannel
│   ├── metrics/            DistributionMetricValue (value object)
│   ├── notification/       Notification, NotificationFactory, SendResult, MessageType
│   ├── observability/      EngineMetrics, EngineErrorTracker
│   ├── operation/          Operation (aggregate root), OperationSnapshot, OperationUpdateResult
│   ├── shared/             round-percentage, take-last
│   ├── statistics/         Statistics (contadores incrementales)
│   └── strategy/           Strategy interface, Streak3Strategy, StrategySignal
├── application/
│   ├── history/            HistoryModule
│   ├── metrics/            DistributionMetric, DistributionMetricModule
│   ├── notification/       NotificationCoordinator, NotificationChannelDispatcher, MessageTracker
│   ├── observability/      EngineMetricsService, EngineHealth
│   ├── operation/          OperationCoordinator, ActiveOperationRegistry
│   ├── statistics/         StatisticsService
│   └── strategy/           StrategyCoordinator, StrategyModule
├── infrastructure/
│   ├── collector/          GameEventCollector, SSE client, GameMapper
│   ├── config/             AppConfigModule
│   ├── shared/             sleep utility
│   └── telegram/           TelegramChannel, MarkdownV2 escaping, retry constants
└── e2e/                    Test end-to-end del pipeline completo
```

Detalle completo de capas, eventos, módulos NestJS y decisiones de diseño en [`ARCHITECTURE.md`](./ARCHITECTURE.md).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este proyecto

Motor de procesamiento de eventos en tiempo real (NestJS + Fastify) que analiza jugadas de BacBo (Evolution, vía la API pública de Tipminer), detecta rachas, simula operaciones de apuesta con martingala y notifica resultados por Telegram.

**No es un CRUD ni una API REST tradicional.** El **motor de alertas** gira alrededor de un único disparador — *llega una jugada nueva* — y sus componentes se comunican exclusivamente a través de un `DomainEventBus` interno, sin conocerse entre sí directamente.

Además del motor hay un **segundo dominio, independiente y con su propio disparador**: Analytics histórico "Racha 3" (`analytics/` en las tres capas, ver [`ANALYTICS.md`](./ANALYTICS.md)). No se suscribe al `DomainEventBus`, no conoce Strategy/Operation/Notification y ninguno de ellos lo conoce; su disparador es un tick de 60 s que procesa las jugadas nuevas hacia tablas derivadas en PostgreSQL. Si Analytics falla o queda sin base de datos, el motor de alertas sigue funcionando exactamente igual — y al revés. No mezclar los dos dominios: **Analytics describe el pasado, nunca decide una alerta.**

Documentación de referencia (leer antes de tocar la arquitectura):
- [`README.md`](./README.md) — visión general, variables de entorno, diagrama de secuencia.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — capas, eventos, módulos NestJS y decisiones de diseño clave (§8), incluyendo por qué el orden de `imports` de NestJS no debe importar para la corrección del sistema.
- [`API.md`](./API.md) — contrato verificado de la API de Tipminer (endpoints, IDs de la mesa Bac Bo, formato SSE).
- [`documentacion_mk_api.md`](./documentacion_mk_api.md) — contrato completo de **nuestra** API propia (`src/api/`): cada endpoint, auth, request/response, códigos de error, formato SSE. Actualizar este documento junto con cualquier cambio en `src/api/`.
- [`DATABASE.md`](./DATABASE.md) — base de datos (PostgreSQL/Supabase vía Prisma): cómo conectarse, esquema real de las 6 tablas (`jugadas`, `report_checkpoints` y las 4 derivadas de Analytics en §11), diagramas y decisiones de diseño.
- [`ANALYTICS.md`](./ANALYTICS.md) — referencia única del dominio Analytics histórico "Racha 3": semántica exacta (columna, gap de 120000 ms, operación, TIE, MG1/MG2/LOSS, PENDIENTE), banderas `bloqueada_por_operacion_previa` e `integridad_ok`, rebuild/incremental/checkpoint, las 17 funciones SQL, invariantes V0–V11, verificación TS↔SQL, y limitaciones conocidas. **Leer antes de tocar cualquier cosa bajo `analytics/`.** Analytics no predice ni decide alertas: entrega evidencia histórica y el Core mantiene la decisión.
- [`3AL3.md`](./3AL3.md) — estrategia `3al3`: la misma Racha 3 que `streak-3`, pero filtrada por la evidencia histórica de Analytics. Solo alerta cuando la tasa defendible del lado apostado supera el **punto de equilibrio** de la escalera de martingala (score = límite inferior del IC95 de Wilson; umbral = `(pérdida + peaje de empates) / (pérdida + ganancia)`). Es una estrategia normal: sin variables de entorno, se enciende asignándola a un canal como las demás, y sus alertas salen por el pipeline de producción. Incluye la fórmula, los gates, el backtest walk-forward y las mediciones que descartan hora/día/distancia como factores.
- [`Mk-Api.md`](./Mk-Api.md) — bitácora de decisiones/ADRs de diseño de `src/api/` (por qué se construyó así, alternativas descartadas). Referenciada por decenas de comentarios en `src/api/` y `src/application/` (`grep -r "Mk-Api.md" src/`) — no borrar sin antes limpiar esas referencias.
- `INIT.md` — documento de arquitectura original/objetivo (fuente de verdad conceptual; `ARCHITECTURE.md` describe el estado real implementado).

## Comandos

```bash
pnpm install
pnpm start:dev          # servidor en modo watch
pnpm build              # compila a dist/
pnpm start:prod         # corre dist/main.js

pnpm lint               # eslint --fix sobre src/apps/libs/test
pnpm format             # prettier --write

pnpm test               # suite unitaria (jest)
pnpm test:watch
pnpm test:cov
pnpm test:e2e           # jest con test/jest-e2e.json

pnpm analytics:rebuild  # reconstrucción histórica completa de Analytics (ver ANALYTICS.md §10.1)
pnpm analytics:verify   # verificación cruzada TS ↔ SQL + invariantes V0-V11. Debe dar 0 diferencias
pnpm 3al3:backtest      # backtest de la estrategia 3al3: retrospectivo vs walk-forward (ver 3AL3.md)
```

`analytics:rebuild` y `analytics:verify` corren con `ts-node` contra la base real y necesitan `DATABASE_URL`/`DIRECT_URL`. `rebuild` es destructivo para las tablas **derivadas** (`TRUNCATE`), nunca para `jugadas`; después de cualquier rebuild hay que correr `verify`.

Ejecutar un solo test: `pnpm test -- ring-buffer.spec` o `pnpm test -- --testPathPattern=streak3`.

Por ahora el proyecto corre únicamente en local (`pnpm start:dev`/`pnpm start:prod`); no hay Docker, Railway ni Render configurados en el repo — se retiraron deliberadamente hasta que haya un VPS disponible.

La suite unitaria vive junto al código como `*.spec.ts` (rootDir `src`, ver `jest` en `package.json`). El test end-to-end real del pipeline completo es `src/e2e/full-pipeline.e2e.spec.ts`: corre el sistema real (Strategy, Operation, Notification, Statistics, EngineMetrics) sobre un `DomainEventBus` real, sin la API de Tipminer; solo dobla el `NotificationChannel` para no tocar Telegram.

CI (`.github/workflows/ci.yml`) corre en cada push/PR a `main`: `pnpm install --frozen-lockfile` → `lint` → `test` → `build`. Node 24, pnpm.

## Arquitectura

Tres capas con dependencia estrictamente unidireccional (verificado con grep en el propio repo — cero imports de `core/` hacia `application/`/`infrastructure/`, cero `@nestjs/*` dentro de `core/`):

```
core/            TypeScript puro. Nunca @nestjs/*. Nunca importa application/ ni infrastructure/.
application/     Orquestación (coordinadores, servicios). Depende solo de core.
infrastructure/  Integraciones externas (Tipminer, Telegram). Depende de core y application.
```

Flujo end-to-end (ver diagrama PlantUML completo en `README.md`):

```
Tipminer (SSE/HTTP) → GameEventCollector → HistoryStore.append()
    → publish(GameReceivedEvent{game, isHistorical})
        → StrategyCoordinator (ignora si isHistorical)
            → Streak4Strategy.evaluate()           ← oficial (racha-4)
            → StrategyTriggeredEvent → OperationCoordinator → Operation.open()
                → OperationOpenedEvent → NotificationCoordinator → TelegramChannel
        → OperationCoordinator (partidas siguientes, actualiza operaciones activas)
        → StatisticsService / EngineMetricsService (cuentan TODO, incl. histórico)
```

Puntos que no son obvios leyendo un solo archivo:

- **`GameEventCollector.start()` es explícito, no `OnModuleInit`.** El orden en que NestJS invoca los `onModuleInit` de distintos módulos no es confiable (verificado empíricamente). `main.ts` llama `collector.start()` manualmente después de `app.listen()`, momento en que NestJS garantiza que todos los `onModuleInit` de la app ya corrieron. No cambiar esto por una suscripción automática vía ciclo de vida de Nest.
- **`GameReceivedEvent.isHistorical`.** La carga inicial de historial (hasta 200 partidas) también dispara este evento, pero con `isHistorical: true`. `StrategyCoordinator` ignora por completo las partidas históricas (una racha de hace horas no es accionable); `StatisticsService`/`EngineMetricsService` sí las cuentan (son analítica descriptiva, no decisión de negocio).
- **`triggerGameUuid` en `StrategySignal`/`Operation`.** Cada señal recuerda qué partida la disparó; la `Operation` ignora esa misma partida si le vuelve a llegar como actualización, para no depender del orden en que los subscribers del bus reaccionan al mismo evento.
- **Salvaguardas contra señales duplicadas:** nunca hay dos operaciones activas simultáneas para la misma estrategia (`StrategyExecutionGuard` / `ActiveOperationRegistry`), y una misma racha nunca genera más de una señal — solo un TIE o un cambio de ganador vuelve a habilitar la estrategia (`StrategyRuntimeState`).
- **Notificaciones son fire-and-forget.** `DomainEventBus.publish()` es síncrono; si `NotificationCoordinator` esperara la respuesta de Telegram, el motor completo se congelaría. El resultado del envío se reporta de vuelta solo vía `NotificationSentEvent`/`NotificationFailedEvent`.
- **Multi-provider manual.** NestJS no acumula providers bajo el mismo token (a diferencia de Angular). Cada estrategia/canal se registra como su propio provider y se agrupa con un `useFactory` en `StrategyModule`/`NotificationModule`. Agregar una estrategia o canal nuevo nunca debe tocar `StrategyCoordinator` ni `NotificationCoordinator`.
- **`EngineHealth` no participa del flujo de eventos**: es una clase de solo-consulta que lee el estado actual de `HistoryStore`, `GameEventCollector`, `OperationCoordinator` y los registros de estrategias/canales bajo demanda (expuesta en `/healthz`).

### Cómo extender

- **Nueva estrategia**: implementar `Strategy` en `core/strategy/strategies/`, registrarla en `StrategyModule` (providers + factory). No tocar `StrategyCoordinator`.
- **Nuevo canal de notificación**: implementar `NotificationChannel` en `infrastructure/`, registrarlo en `NotificationModule`. No tocar `NotificationCoordinator`.
- **Nuevo evento de `Operation`**: agregar la clase en `core/domain-events/operation/`, sumar entrada a `EVENT_FACTORY_BY_STATE` en `operation.coordinator.ts` y un método en `NotificationFactory`.

## API externa (Tipminer)

Detalle completo verificado en `API.md`. Puntos que generan bugs si se pasan por alto:

- En rutas `/rounds/...` siempre va el **`provider`** (uuid de la mesa), nunca el uuid del juego — si te equivocas, la API responde `[]` sin error.
- `limit` en `/history` tiene tope real de 200 aunque pidas más.
- Filtros de query (`types`, `date`, `resultIni`, etc.) se ignoran sin sesión iniciada; hay que filtrar client-side.
- El SSE de `/live` no incluye `version` ni `externalId`, solo `uuid`, `type`, `result`, `instant`.
- `type` tiene 3 valores posibles: `PLAYER`, `BANKER`, `TIE` — un parser que solo contempla los primeros dos pierde rondas.
- Solo el backend consume la API de Tipminer; el frontend nunca la llama directo (CORS/diseño).

## Estilo de código

- Prettier: comillas simples, `trailingComma: all` (ver `.prettierrc`).
- ESLint usa `typescript-eslint` con `recommendedTypeChecked`. `no-explicit-any` está desactivado; `no-floating-promises` y `no-unsafe-argument` son solo `warn`. En archivos `*.spec.ts`, `unbound-method` está desactivado (referenciar un método de un mock, p. ej. `expect(store.append)...`, es un patrón válido de Jest).

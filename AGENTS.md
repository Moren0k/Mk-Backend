# AGENTS.md

> ⚠️ **Este archivo es TEMPORAL.** Existe únicamente para guiar al agente
> de IA que implemente la lógica de la estrategia `alternancia34`. Cuando
> esa estrategia quede completamente implementada, probada y activada,
> **borra este archivo por completo** — no dejes esta sección obsoleta en
> el repositorio. La documentación permanente para crear estrategias vive
> en [`ARCHITECTURE.md`](./ARCHITECTURE.md) §12.1, que no se borra.

## Contexto

El Canal Oficial de Telegram usa hoy `Streak4Strategy` (racha de 4). El
Canal de Pruebas está operativo (bot, chat, scheduler, resúmenes) pero sin
ninguna estrategia activa: está preparado para `alternancia34`.

La plantilla ya existe en
`src/core/strategy/strategies/alternancia34.strategy.ts` y ya está
completamente cableada:
- Registrada en `StrategyModule` (`src/application/strategy/strategy.module.ts`).
- Clasificada como grupo `'pruebas'` en `strategy-group.ts`
  (`src/core/strategy/strategy-group.ts`, `TEST_ONLY_STRATEGY_IDS`).
- `enabled()` devuelve `false` — no genera señales ni envía nada mientras
  no se active a propósito.

## Tu tarea

Implementar la lógica de detección real dentro de
`Alternancia34Strategy.evaluate()` (ver los TODOs en el propio archivo, y
la guía completa en `ARCHITECTURE.md` §12.1). En resumen:

1. Leer `context.historySnapshot` para reconstruir el patrón de
   alternancia vigente (recalculando siempre desde el historial, nunca
   acumulando estado evento a evento).
2. Preguntar `context.execution.canExecute(this.id)` antes de evaluar nada.
3. Usar `context.runtimeState` para no repetir señal sobre la misma
   ocurrencia del patrón.
4. Devolver un `StrategySignal` completo cuando corresponda disparar.
5. Una vez que tus specs (`alternancia34.strategy.spec.ts`, reemplazando
   el spec mínimo de plantilla) y la suite completa pasen en verde,
   cambiar `enabled()` para que devuelva `true`.

## Qué NO tocar

Todo lo demás ya está resuelto y es genérico por `strategyId` — no hace
falta (y no deberías) modificar:

- `StrategyCoordinator`, `OperationCoordinator`, `ActiveOperationRegistry`.
- `NotificationCoordinator`, `NotificationChannelDispatcher`,
  `NotificationFactory`, `TelegramChannel`, `NotificationModule`.
- `ReportScheduler`, `ReportNotificationCoordinator`,
  `SummaryReportService`, `build-group-metrics.ts`.
- `strategy-group.ts` — salvo que decidas intencionalmente que
  `alternancia34` vaya al canal Oficial en vez de Pruebas (en cuyo caso,
  quitar su id de `TEST_ONLY_STRATEGY_IDS`).
- Ninguna otra estrategia (`Streak3Strategy`, `Streak4Strategy`).

Si te encuentras necesitando tocar alguno de estos archivos para que
`alternancia34` funcione, es una señal de que algo en tu enfoque no está
usando el contrato `Strategy` correctamente — revisa `ARCHITECTURE.md`
§12.1 antes de continuar.

## Checklist antes de dar por terminado

- [ ] `alternancia34.strategy.spec.ts` cubre la lógica real (no solo el
      cableado de la plantilla).
- [ ] `enabled()` devuelve `true`.
- [ ] `pnpm lint` sin errores.
- [ ] `pnpm test` completo en verde.
- [ ] `pnpm build` sin errores.
- [ ] Verificar manualmente (o con un test) que
      `resolveStrategyGroup('alternancia-34')` sigue devolviendo
      `'pruebas'` y que sus notificaciones llegan solo al chat de pruebas.
- [ ] **Borrar este archivo (`AGENTS.md`) por completo.**

import { WinnerType } from '../../enums/winner-type.enum';
import { StrategyGroup } from '../strategy-group';

/**
 * Entidad de dominio que representa una oportunidad detectada por una
 * Strategy. `maxMartingales` es lo único que necesita Operation para saber
 * cuándo darse por vencida: cada estrategia decide su propio valor (0, 1,
 * 2, 3...) y Operation nunca lo hardcodea.
 *
 * `triggerGameUuid` identifica la partida que disparó la señal. Operation
 * lo recuerda como `triggerGameId` e ignora esa partida si alguna vez le
 * llega como actualización: así la corrección no depende del orden en que
 * los subscribers del DomainEventBus se registren (ver Etapa 7/8).
 */
export type StrategySignal = {
  readonly triggered: true;
  readonly strategyId: string;
  readonly strategyName: string;
  readonly triggeredAt: Date;
  readonly recommendedWinner: WinnerType;
  readonly streakWinner: WinnerType;
  readonly maxMartingales: number;
  readonly triggerGameUuid: string;
  readonly reason: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

/**
 * `StrategySignal` enriquecido con el contexto de negocio ('oficial' |
 * 'pruebas') vigente en el instante exacto en que la señal se disparó.
 *
 * Lo estampa exclusivamente `StrategyCoordinator` (nunca la propia
 * Strategy: una estrategia solo detecta oportunidades, no gobierna a qué
 * contexto pertenecen), consultando `StrategyChannelRegistry` una única
 * vez, justo antes de publicar `StrategyTriggeredEvent`. A partir de ahí el
 * contexto viaja congelado a través de `Operation`, sus eventos y el store
 * de reportes: nunca se vuelve a derivar de `strategyId`. Esto es
 * deliberado — la estrategia puede reasignarse a otro canal más adelante
 * (incluso puede cambiar) sin que eso altere el contexto de una operación
 * ya abierta o ya cerrada.
 */
export type StrategyTrigger = StrategySignal & {
  readonly context: StrategyGroup;
};

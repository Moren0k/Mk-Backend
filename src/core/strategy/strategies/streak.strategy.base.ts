import { WinnerType } from '../../enums/winner-type.enum';
import { HistorySnapshot } from '../../interfaces/history-snapshot.interface';
import { Strategy } from '../interfaces/strategy.interface';
import { StrategyContext } from '../types/strategy-context.type';
import { StrategyResult } from '../types/strategy-result.type';

const OPPOSITE_WINNER: Readonly<Record<WinnerType, WinnerType | undefined>> = {
  [WinnerType.PLAYER]: WinnerType.BANKER,
  [WinnerType.BANKER]: WinnerType.PLAYER,
  [WinnerType.TIE]: undefined,
};

const NO_SIGNAL: StrategyResult = Object.freeze({ triggered: false });

type CurrentStreak = {
  readonly winner: WinnerType;
  readonly length: number;
  readonly startGameUuid: string;
};

/**
 * Cuando una racha de PLAYER o BANKER alcanza `streakLength`, recomienda
 * apostar al ganador opuesto. Un TIE rompe cualquier racha en curso. Una vez
 * que una racha concreta ya generó su señal, seguir alargándose no genera
 * señales nuevas: solo una señal por racha, sin importar cuánto dure ni si
 * la Operation que originó ya se resolvió mientras tanto. La racha solo
 * vuelve a estar disponible cuando termina (cambia el ganador o aparece un
 * TIE) y una nueva empieza a formarse desde cero.
 *
 * Extraída de la implementación original de Streak3Strategy para que
 * cualquier variante de "racha de N" (Streak3Strategy, Streak4Strategy...)
 * reutilice exactamente la misma lógica de detección, guard y
 * anti-duplicación, sin duplicar código: lo único que cambia entre
 * variantes es `streakLength`, `maxMartingales`, `id`, `name` y
 * `description`.
 *
 * Para saber "qué racha ya generó señal" sin cargar un campo mutable
 * propio, usa `context.runtimeState`: guarda el uuid de la primera partida
 * de la racha señalada, y la recalcula desde cero (nunca la acumula
 * incrementalmente evento a evento) leyendo `context.historySnapshot` en
 * cada evaluación. Así el criterio sobrevive un reinicio del proceso y
 * respeta correctamente el historial ya cargado al arrancar, algo que una
 * máquina de estados alimentada solo por partidas en vivo no podría
 * garantizar (StrategyCoordinator nunca evalúa partidas históricas).
 *
 * El historial tiene un tope fijo (MAX_HISTORY_SIZE, ver
 * history.constants.ts), así que recorrerlo completo hacia atrás para
 * encontrar el inicio de la racha es un costo acotado y trivial, no un
 * recorrido sin límite.
 *
 * Antes de evaluar la racha, también pregunta a `context.execution` si
 * tiene permitido emitir señal. No sabe por qué podría estar bloqueada (una
 * operación propia sigue activa, un cooldown, etc.): eso es responsabilidad
 * exclusiva de quien implemente StrategyExecutionGuard. Ambos chequeos son
 * independientes: uno evita operaciones concurrentes, el otro evita
 * repetir señal sobre la misma racha.
 */
export abstract class StreakStrategyBase implements Strategy {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;

  protected constructor(
    private readonly streakLength: number,
    private readonly maxMartingales: number,
  ) {}

  enabled(): boolean {
    return true;
  }

  evaluate(context: StrategyContext): StrategyResult {
    if (!context.execution.canExecute(this.id)) {
      return NO_SIGNAL;
    }

    const streak = this.computeCurrentStreak(context.historySnapshot);
    if (!streak || streak.length < this.streakLength) {
      return NO_SIGNAL;
    }

    const lastSignaledStreakStartUuid = context.runtimeState.get<string>(
      this.id,
    );
    if (streak.startGameUuid === lastSignaledStreakStartUuid) {
      return NO_SIGNAL;
    }

    const recommendedWinner = OPPOSITE_WINNER[streak.winner];
    if (!recommendedWinner) {
      return NO_SIGNAL;
    }

    context.runtimeState.set(this.id, streak.startGameUuid);

    return {
      triggered: true,
      strategyId: this.id,
      strategyName: this.name,
      triggeredAt: context.timestamp,
      recommendedWinner,
      streakWinner: streak.winner,
      maxMartingales: context.config.getMaxMartingales(
        this.id,
        this.maxMartingales,
      ),
      triggerGameUuid: context.currentGame.uuid,
      reason: `Racha de ${streak.length} resultados consecutivos de ${streak.winner}.`,
      metadata: {
        streakGameUuids: context.historySnapshot
          .getLast(this.streakLength)
          .map((game) => game.uuid),
      },
    };
  }

  /**
   * Reconstruye la racha vigente (ganador, longitud, y uuid de la partida
   * en la que empezó) escaneando el historial hacia atrás desde la más
   * reciente, hasta encontrar un TIE, un cambio de ganador, o el inicio del
   * historial. `undefined` si no hay partidas o si la más reciente es TIE
   * (un TIE nunca es parte de ninguna racha).
   */
  private computeCurrentStreak(
    snapshot: HistorySnapshot,
  ): CurrentStreak | undefined {
    const games = snapshot.getAll();
    if (games.length === 0) {
      return undefined;
    }

    const latest = games[games.length - 1];
    if (latest.winner === WinnerType.TIE) {
      return undefined;
    }

    let length = 1;
    let index = games.length - 2;
    while (index >= 0 && games[index].winner === latest.winner) {
      length += 1;
      index -= 1;
    }

    return {
      winner: latest.winner,
      length,
      startGameUuid: games[index + 1].uuid,
    };
  }
}

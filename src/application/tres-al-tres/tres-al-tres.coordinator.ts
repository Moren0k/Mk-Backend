import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { horaColombia } from '../../core/analytics/racha3-reference';
import {
  DOMAIN_EVENT_BUS,
  HISTORY_STORE,
  STRATEGIES,
  STRATEGY_EXECUTION_GUARD,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import { Game } from '../../core/history/game.type';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import { createStrategyContext } from '../../core/strategy/types/strategy-context.type';
import type { StrategySignal } from '../../core/strategy/types/strategy-signal.type';
import { PARAMETROS_3AL3 } from '../../core/tres-al-tres/parametros';
import { calcularTresAlTresScore } from '../../core/tres-al-tres/tres-al-tres-score.calculator';
import { TRES_AL_TRES_ID } from '../../core/tres-al-tres/types/tres-al-tres.type';
import { InMemoryStrategyRuntimeState } from '../strategy/in-memory-strategy-runtime-state';
import { StrategyChannelRegistry } from '../strategy/strategy-channel-registry';
import { TresAlTresEvidenceProvider } from './tres-al-tres.evidence-provider';

/** Id de la estrategia real que se reutiliza SOLO para detectar la señal. */
const ESTRATEGIA_BASE_ID = 'streak-3';

/**
 * Estrategia 3al3: Racha 3 filtrada por la evidencia histórica.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ HACE
 *
 * Detecta la misma oportunidad que `streak-3` y le aplica un filtro
 * económico: solo emite si la tasa de acierto del lado que se va a apostar
 * supera el PUNTO DE EQUILIBRIO de la escalera de martingala, siendo
 * pesimista con la incertidumbre de la muestra. Cuando decide TOMAR
 * publica `StrategyTriggeredEvent` y el motor de producción hace el resto:
 * `OperationCoordinator` abre la operación REAL y
 * `NotificationCoordinator` manda la alerta de siempre.
 *
 * Cuando decide NO TOMAR no publica nada. La decisión y su motivo quedan
 * en el log estructurado, nunca en el chat: emitir un mensaje por cada
 * oportunidad descartada serían ~2.600 mensajes al día para decir que no.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UN COORDINATOR Y NO SOLO UNA `Strategy`
 *
 * `Strategy.evaluate()` es SÍNCRONO y el `DomainEventBus` publica síncrono.
 * No hay forma de esperar una consulta a PostgreSQL dentro de `evaluate()`,
 * y esta estrategia necesita la evidencia de Analytics para decidir. Por eso
 * la detección vive acá, suscrita por su cuenta a `GameReceivedEvent` igual
 * que `StrategyCoordinator`.
 *
 * `TresAlTresStrategy` sí está registrada en el token `STRATEGIES`, pero su
 * `evaluate()` devuelve siempre `NO_SIGNAL`: existe para que 3al3 aparezca
 * en `GET /api/v1/strategies` y se pueda asignar a un canal. Ver el
 * comentario de esa clase.
 *
 * ─────────────────────────────────────────────────────────────────────
 * MISMOS INTERRUPTORES QUE EL RESTO DEL MOTOR
 *
 * Se replican los dos gates de `StrategyCoordinator`, en el mismo orden:
 *
 * El ÚNICO interruptor es el mismo que el del resto del motor:
 * `StrategyChannelRegistry.isActiveFor('3al3')` — la estrategia tiene que
 * estar asignada a un canal y ese canal tiene que estar activo, ambos vía
 * `PATCH /api/v1/channels/:channel`. Sin asignar, no se consulta ni
 * Analytics: además de no alertar, no se gasta una consulta por jugada.
 *
 * No hay variables de entorno. 3al3 no pide nada al despliegue, igual que
 * `streak-3` y `streak-4`; sus parámetros están en
 * `core/tres-al-tres/parametros.ts` con el motivo de cada número.
 *
 * El `context` ('oficial' | 'pruebas') se estampa desde el mismo registro,
 * exactamente como lo hace `StrategyCoordinator`, así que la operación nace
 * con el canal correcto y los reportes la agrupan bien.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTADO PROPIO Y ESTADO COMPARTIDO
 *
 * `execution`        el guard REAL (`ActiveOperationRegistry`), consultado
 *                    con el id `3al3`. Así nunca hay dos operaciones de
 *                    3al3 a la vez, y no interfiere con las de `streak-3`
 *                    ni `streak-4`, que se miran por su propio id.
 * `config`           `StrategyChannelRegistry`, igual que el resto: el
 *                    `maxMartingales` de 3al3 es configurable por API.
 * `runtimeState`     instancia PROPIA, y es obligatorio. La detección
 *                    reutiliza la instancia real de `Streak3Strategy`, y
 *                    `StreakStrategyBase` guarda su anti-duplicación bajo
 *                    la clave de SU id (`'streak-3'`). Compartir el
 *                    singleton haría que 3al3 y `streak-3` se pisaran el
 *                    estado y se robaran señales entre sí.
 * `historySnapshot`  compartido, y no puede ser de otra forma: es el
 *                    historial del juego. Snapshot inmutable, solo lectura.
 */
@Injectable()
export class TresAlTresCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('3al3');

  /** Estado de anti-duplicación PROPIO. Nunca el singleton compartido. */
  private readonly runtimeState = new InMemoryStrategyRuntimeState();

  private readonly handler: DomainEventHandler<GameReceivedEvent> = {
    handle: (event) => this.onGameReceived(event),
  };

  /**
   * Oportunidades con la evaluación asíncrona en vuelo.
   *
   * El guard real solo sabe de operaciones ya abiertas, y entre detectar la
   * señal y terminar la consulta a Analytics pasan cientos de milisegundos.
   * Sin esta reserva, dos señales seguidas lanzarían dos evaluaciones y
   * podrían publicar dos `StrategyTriggeredEvent` — el motor abriría una
   * operación y descartaría la otra, pero el log quedaría mintiendo.
   */
  private evaluacionEnCurso = false;

  private estrategiaBase: Strategy | undefined;

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
    @Inject(STRATEGIES) private readonly strategies: readonly Strategy[],
    @Inject(STRATEGY_EXECUTION_GUARD)
    private readonly execution: StrategyExecutionGuard,
    private readonly canales: StrategyChannelRegistry,
    private readonly evidencia: TresAlTresEvidenceProvider,
  ) {}

  onModuleInit(): void {
    this.estrategiaBase = this.strategies.find(
      (s) => s.id === ESTRATEGIA_BASE_ID,
    );

    if (this.estrategiaBase === undefined) {
      // Falla cerrado: sin la estrategia base no hay detección posible, y
      // reimplementarla acá sería duplicar la lógica del motor.
      this.logger.error(
        `No se encontró la estrategia base "${ESTRATEGIA_BASE_ID}" en el token ` +
          'STRATEGIES. 3al3 queda inactiva.',
      );
      return;
    }

    this.domainEventBus.subscribe(GameReceivedEvent.eventName, this.handler);
    this.logger.log(
      '3al3 registrada. Alerta solo cuando la evidencia supera el punto de ' +
        `equilibrio. escalera=[${PARAMETROS_3AL3.escalera.join(',')}] ` +
        `devolucionTie=${PARAMETROS_3AL3.devolucionTie} ` +
        `exigirModelo=${PARAMETROS_3AL3.exigirModelo} ` +
        `muestraMinima=${PARAMETROS_3AL3.muestraMinima} ` +
        `maxRezago=${PARAMETROS_3AL3.maxRezagoJugadas}. ` +
        'Emite cuando se le asigne un canal activo.',
    );
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(GameReceivedEvent.eventName, this.handler);
  }

  private onGameReceived(event: GameReceivedEvent): void {
    if (event.payload.isHistorical) {
      return;
    }

    // Mismo gate de negocio que `StrategyCoordinator`: sin canal activo
    // asignado, ni se detecta ni se consulta Analytics.
    if (!this.canales.isActiveFor(TRES_AL_TRES_ID)) {
      return;
    }

    const señal = this.detectar(event.payload.game);

    if (señal === undefined) {
      return;
    }

    this.evaluacionEnCurso = true;
    void this.evaluar(señal, event.payload.game);
  }

  private detectar(game: Game): StrategySignal | undefined {
    if (this.estrategiaBase === undefined) {
      return undefined;
    }

    const contexto = createStrategyContext(
      game,
      this.historyStore.createSnapshot(),
      // El guard se pregunta por el id de 3al3, no por el de la estrategia
      // base: lo que bloquea es que 3al3 ya tenga una operación abierta.
      { canExecute: () => this.puedeEmitir() },
      this.runtimeState,
      this.canales,
      new Date(),
    );

    try {
      const resultado = this.estrategiaBase.evaluate(contexto);
      return resultado.triggered ? resultado : undefined;
    } catch (error) {
      this.logger.warn(
        'La detección de 3al3 falló y se descarta esta jugada: ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private puedeEmitir(): boolean {
    return (
      !this.evaluacionEnCurso && this.execution.canExecute(TRES_AL_TRES_ID)
    );
  }

  /**
   * Evaluación asíncrona: recolecta evidencia, calcula el score, decide y
   * —solo si es TOMAR— publica la señal al motor. Nunca lanza: un fallo acá
   * no puede afectar al resto del sistema.
   */
  private async evaluar(señal: StrategySignal, game: Game): Promise<void> {
    const evaluacionId = randomUUID();

    try {
      const hora = horaColombia(game.playedAt);
      const dia = diaSemanaColombia(game.playedAt);

      this.logger.log(
        `3al3_signal evaluacionId=${evaluacionId} ` +
          `triggerGameUuid=${game.uuid} tipoRacha=${señal.streakWinner} ` +
          `apuesta=${señal.recommendedWinner} horaColombia=${hora}`,
      );

      const recolectada = await this.evidencia.recolectar(
        señal.streakWinner,
        game.playedAt,
        hora,
        dia,
      );

      const score = calcularTresAlTresScore({
        evidencia: recolectada.evidencia,
        lados: recolectada.lados,
        tiesPorNivel: recolectada.tiesPorNivel,
        operacionesMedidas: recolectada.operacionesMedidas,
        apuesta: señal.recommendedWinner,
        contexto: recolectada.contexto,
        estadoAnalytics: recolectada.estadoAnalytics,
        operacionVirtualAbierta: false,
        parametros: PARAMETROS_3AL3,
      });

      this.logger.log(
        `3al3_score evaluacionId=${evaluacionId} score=${score.score ?? 'null'} ` +
          `umbral=${score.umbral} nivel=${score.nivel} ` +
          `directo=${score.scoreDirecto ?? 'n/d'} modelo=${score.scoreModelo ?? 'n/d'} ` +
          `ev=${score.economia.evEstimado?.toFixed(5) ?? 'n/d'} ` +
          `peajeTie=${score.economia.peajeTiePorOperacion.toFixed(5)} ` +
          `muestraN=${score.componentes.muestra.muestraN} ` +
          `tasaObservada=${score.componentes.historico.tasaObservada?.toFixed(6) ?? 'n/d'} ` +
          `icInferior=${score.componentes.intervalo?.limiteInferior.toFixed(6) ?? 'n/d'} ` +
          `rezago=${recolectada.estadoAnalytics.jugadasSinProcesar}`,
      );

      const gatesDisparados = score.gates
        .filter((g) => g.disparado)
        .map((g) => g.gate);

      this.logger.log(
        `3al3_decision evaluacionId=${evaluacionId} ` +
          `decision=${score.tomar ? 'TOMAR' : 'NO_TOMAR'} ` +
          `gatesDisparados=[${gatesDisparados.join(',')}] ` +
          `razones="${score.razones.join(' | ')}"`,
      );

      if (!score.tomar) {
        // Sin publicar nada: la oportunidad descartada existe en el log y en
        // ningún otro sitio. No hay mensaje, no hay operación, no hay métrica.
        return;
      }

      this.emitir(señal, evaluacionId, score.score);
    } catch (error) {
      // Un fallo NUNCA produce una alerta: se registra y se descarta.
      this.logger.error(
        `3al3_error evaluacionId=${evaluacionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.evaluacionEnCurso = false;
    }
  }

  /**
   * Publica la señal al motor de producción.
   *
   * Se revalida el guard justo antes: entre que empezó la consulta a
   * Analytics y ahora, `streak-3` o `streak-4` pueden haber hecho cualquier
   * cosa, y sobre todo puede haberse abierto una operación de 3al3 por una
   * señal anterior. El motor la descartaría igual, pero es mejor no
   * publicar una señal que ya sabemos inválida.
   */
  private emitir(
    señal: StrategySignal,
    evaluacionId: string,
    score: number | null,
  ): void {
    if (!this.execution.canExecute(TRES_AL_TRES_ID)) {
      this.logger.log(
        `3al3_descartada evaluacionId=${evaluacionId} ` +
          'motivo=operacion_de_3al3_ya_abierta_al_terminar_la_evaluacion',
      );
      return;
    }

    // Garantizado no-undefined por el gate `isActiveFor` de `onGameReceived`.
    // El fallback es defensivo, nunca una fuente real de verdad.
    const canal = this.canales.getChannelFor(TRES_AL_TRES_ID) ?? 'oficial';

    this.domainEventBus.publish(
      new StrategyTriggeredEvent({
        ...señal,
        // La señal la produjo la instancia de `Streak3Strategy`, así que
        // viene firmada como `streak-3`. Se reemplaza la identidad por la de
        // 3al3 para que la operación, los reportes y las métricas la
        // atribuyan a quien realmente decidió.
        strategyId: TRES_AL_TRES_ID,
        strategyName: 'TresAlTresStrategy',
        maxMartingales: this.canales.getMaxMartingales(
          TRES_AL_TRES_ID,
          señal.maxMartingales,
        ),
        reason:
          `${señal.reason} Evidencia histórica por encima del punto de ` +
          `equilibrio (score ${score ?? 'n/d'}).`,
        metadata: { ...señal.metadata, evaluacionId, score },
        context: canal,
      }),
    );

    this.logger.log(
      `3al3_emitida evaluacionId=${evaluacionId} canal=${canal} score=${score ?? 'n/d'}`,
    );
  }
}

/**
 * Día de la semana (0=domingo) en hora de Colombia.
 *
 * Se formatea la fecha EN la zona y se reconstruye a mediodía UTC, en vez de
 * usar `getDay()` sobre el instante: `getDay()` devolvería el día de la zona
 * de la máquina, que en un servidor puede no ser Bogotá.
 */
function diaSemanaColombia(instante: Date): number {
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);

  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

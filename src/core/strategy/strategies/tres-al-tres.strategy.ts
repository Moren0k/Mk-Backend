import { Strategy } from '../interfaces/strategy.interface';
import { StrategyResult } from '../types/strategy-result.type';
import {
  TRES_AL_TRES_ID,
  TRES_AL_TRES_NAME,
} from '../../tres-al-tres/types/tres-al-tres.type';

const NO_SIGNAL: StrategyResult = Object.freeze({ triggered: false });

/**
 * Estrategia "3al3": Racha 3 filtrada por la evidencia histórica.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ `evaluate()` NO DETECTA NADA
 *
 * Esta clase existe para dar IDENTIDAD a la estrategia, no para evaluarla.
 * Devuelve siempre `NO_SIGNAL`, a propósito.
 *
 * `Strategy.evaluate()` es SÍNCRONO y `DomainEventBus.publish()` también,
 * así que dentro de este método no se puede esperar una consulta a
 * PostgreSQL — y 3al3 necesita la evidencia de Analytics para decidir. La
 * detección real vive en `TresAlTresCoordinator`, que se suscribe por su
 * cuenta a `GameReceivedEvent`, hace la consulta de forma asíncrona y
 * publica `StrategyTriggeredEvent` con este mismo `id` cuando la decisión
 * es TOMAR. A partir de ahí el motor de producción sigue su curso normal:
 * `OperationCoordinator` abre la operación y `NotificationCoordinator`
 * manda la alerta de siempre.
 *
 * ¿Y para qué registrarla entonces? Porque el catálogo que alimenta el
 * selector del frontend (`StrategyCatalogReadModel` →
 * `GET /api/v1/strategies`) se construye desde el token `STRATEGIES`. Sin
 * estar acá, 3al3 no aparecería en la lista y no se podría asignar a un
 * canal con `PATCH /api/v1/channels/:channel` — que es el único
 * interruptor real de encendido del sistema.
 *
 * Consecuencia deseada: `StrategyCoordinator` la recorre en cada jugada y
 * no hace nada, mientras el coordinator propio decide. No hay doble
 * evaluación ni doble señal.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ LA DISTINGUE DE `streak-3`
 *
 * La detección es idéntica — de hecho `TresAlTresCoordinator` reutiliza la
 * instancia real de `Streak3Strategy` para detectar. Lo que 3al3 añade es
 * el filtro: solo emite si la tasa de acierto histórica del lado que se va
 * a apostar supera el PUNTO DE EQUILIBRIO de la escalera, siendo pesimista
 * con la incertidumbre de la muestra (ver `core/tres-al-tres/equilibrio.ts`).
 *
 * Las dos pueden coexistir asignadas a canales distintos: `streak-3` alerta
 * en todas las Racha 3, 3al3 solo en las que la evidencia respalda.
 */
export class TresAlTresStrategy implements Strategy {
  readonly id = TRES_AL_TRES_ID;
  readonly name = TRES_AL_TRES_NAME;
  readonly description =
    'Racha de 3 filtrada por evidencia histórica: solo emite si la tasa ' +
    'defendible del lado apostado supera el punto de equilibrio de la ' +
    'escalera de martingala.';

  enabled(): boolean {
    return true;
  }

  /**
   * Siempre `NO_SIGNAL`. La detección real es asíncrona y vive en
   * `TresAlTresCoordinator`; ver el comentario de la clase.
   */
  evaluate(): StrategyResult {
    return NO_SIGNAL;
  }
}

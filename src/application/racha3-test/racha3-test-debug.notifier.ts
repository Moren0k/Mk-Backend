import { Inject, Injectable, Logger } from '@nestjs/common';

import { RACHA3_TEST_DEBUG_CHANNEL } from '../../core/constants/injection-tokens.constants';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import {
  crearNotificacionRacha3Test,
  crearNotificacionResolucionRacha3Test,
} from '../../core/racha3-test/racha3-test-debug.formatter';
import {
  Racha3TestEvaluacion,
  Racha3TestResolucion,
} from '../../core/racha3-test/types/racha3-test.type';

/**
 * Envía los mensajes DEBUG de Racha 3 Test a su canal dedicado.
 *
 * Dos decisiones de aislamiento, las dos deliberadas:
 *
 * 1. **No usa `NotificationChannelDispatcher`.** Ese dispatcher publica
 *    `NotificationSentEvent`/`NotificationFailedEvent` en el bus, y
 *    `EngineMetricsService` los cuenta: cada mensaje DEBUG habría inflado
 *    la métrica `notificationsSent` que expone `/healthz` y
 *    `GET /api/v1/health`. Un experimento no debe mover los números con los
 *    que se mira la salud de producción. Acá se llama `channel.send()`
 *    directo y no se publica ningún evento de dominio.
 *
 * 2. **No aplica `channel.supports()`.** El canal DEBUG es de destino único
 *    y ya está elegido a propósito; `supports()` filtra por asignación de
 *    estrategia a canal en `StrategyChannelRegistry`, que es precisamente el
 *    acoplamiento del que este canal se separa.
 *
 * Un fallo de envío nunca propaga: el experimento no puede tumbar el motor,
 * y no enviar un mensaje de observabilidad no invalida la evaluación que ya
 * quedó en el log estructurado.
 */
@Injectable()
export class Racha3TestDebugNotifier {
  private readonly logger = new Logger(Racha3TestDebugNotifier.name);

  constructor(
    @Inject(RACHA3_TEST_DEBUG_CHANNEL)
    private readonly canal: NotificationChannel,
  ) {}

  /** Mensaje de decisión: TOMAR o NO TOMAR, con todo el análisis. */
  notificarEvaluacion(evaluacion: Racha3TestEvaluacion): void {
    if (!this.canal.enabled()) {
      this.logger.debug(
        `Canal DEBUG deshabilitado: no se envía la evaluación ${evaluacion.evaluacionId}.`,
      );
      return;
    }

    this.enviar(
      crearNotificacionRacha3Test(evaluacion, this.canal.getChannelType()),
      `evaluación ${evaluacion.evaluacionId}`,
    );
  }

  /** Mensaje de cierre de una operación virtual ya resuelta. */
  notificarResolucion(resolucion: Racha3TestResolucion): void {
    if (!this.canal.enabled()) {
      return;
    }

    this.enviar(
      crearNotificacionResolucionRacha3Test(
        resolucion,
        this.canal.getChannelType(),
      ),
      `resolución de ${resolucion.evaluacionId}`,
    );
  }

  private enviar(
    notificacion: ReturnType<typeof crearNotificacionRacha3Test>,
    descripcion: string,
  ): void {
    void this.canal.send(notificacion).then(
      (resultado) => {
        if (!resultado.delivered) {
          this.logger.warn(
            `El canal DEBUG agotó sus reintentos enviando la ${descripcion}.`,
          );
        }
      },
      (error: unknown) => {
        this.logger.warn(
          `Fallo inesperado enviando la ${descripcion} al canal DEBUG: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }
}

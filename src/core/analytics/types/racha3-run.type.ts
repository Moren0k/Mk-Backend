/**
 * Resultado de una corrida del procesamiento incremental de Racha 3, tal
 * como lo reporta `analytics_racha3_incremental()`.
 *
 * Unión discriminada a propósito: los tres desenlaces posibles se tratan de
 * forma distinta y no deben poder confundirse.
 *
 *   OK             la función corrió y la transacción confirmó. Puede no
 *                  haber cambiado nada (`huboCambios = false`): sin jugadas
 *                  nuevas, la corrida es un no-op absoluto y ni siquiera
 *                  reclama el checkpoint.
 *   ERROR_PROCESO  la función corrió pero abortó su propio trabajo (p. ej.
 *                  detectó una inserción retroactiva). Todo lo derivado se
 *                  revirtió y el checkpoint NO avanzó, pero la bitácora
 *                  `analytics_ejecuciones` sí registró el fallo. Es un
 *                  problema real de dominio, no un hipo de red.
 *   NO_DISPONIBLE  no hay conexión configurada (DATABASE_URL ausente o el
 *                  cliente Prisma nunca llegó a conectar). No es un error:
 *                  es el modo degradado normal del proyecto.
 *
 * Un fallo transitorio de red NO aparece acá: se propaga como excepción y
 * lo clasifica quien invoca (ver Racha3IncrementalScheduler).
 */
export type Racha3RunResult =
  | {
      readonly tipo: 'OK';
      readonly ejecucionId: bigint;
      /** Punto de rebobinado desde el que se releyó. `null` en un no-op. */
      readonly desdeJugadaId: bigint | null;
      readonly hastaJugadaId: bigint | null;
      readonly jugadasLeidas: number;
      readonly columnasAfectadas: number;
      readonly operacionesAfectadas: number;
      /** Duración medida por la propia función SQL. */
      readonly duracionMs: number;
      /** `false` cuando no había jugadas nuevas: no se tocó ni una fila. */
      readonly huboCambios: boolean;
    }
  | {
      readonly tipo: 'ERROR_PROCESO';
      readonly ejecucionId: bigint;
      readonly error: string;
      readonly duracionMs: number;
    }
  | {
      readonly tipo: 'NO_DISPONIBLE';
      readonly motivo: string;
    };

/** Estado del checkpoint, solo para observabilidad. */
export type Racha3CheckpointSnapshot = {
  readonly ultimaJugadaId: bigint;
  readonly reprocesoDesdeJugadaId: bigint;
  readonly actualizadoEn: Date;
};

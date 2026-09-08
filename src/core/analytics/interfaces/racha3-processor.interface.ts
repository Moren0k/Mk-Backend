import {
  Racha3CheckpointSnapshot,
  Racha3RunResult,
} from '../types/racha3-run.type';

/**
 * Puerta única hacia el procesamiento incremental de Racha 3.
 *
 * Deliberadamente mínima: NO expone consultas, ni agregaciones, ni nada que
 * se parezca a lógica analítica. Toda la reconstrucción (columnas,
 * oportunidades, martingalas, derivados) vive dentro de las funciones
 * plpgsql; esta interfaz solo permite dispararla y observar el resultado.
 *
 * Ese límite es la razón de ser del contrato: mientras `application/` solo
 * pueda pedir "procesá lo nuevo" y "decime cómo quedó el checkpoint", es
 * imposible que la lógica analítica se filtre fuera de SQL y empiece a
 * existir en dos lugares a la vez.
 *
 * Ninguna implementación debe lanzar por un fallo de dominio: eso viaja
 * como `Racha3RunResult`. Sí puede lanzar por un fallo de transporte (red,
 * pooler caído), porque quien la invoca necesita distinguir un hipo de
 * conexión de un problema real.
 */
export interface Racha3Processor {
  /**
   * Ejecuta `analytics_racha3_incremental()`. La exclusión mutua entre
   * procesos ya la garantiza el propio SQL con
   * `pg_advisory_xact_lock(42, 3)`.
   */
  procesarIncremental(): Promise<Racha3RunResult>;

  /**
   * Estado actual del checkpoint. Solo observabilidad: nunca condiciona el
   * procesamiento, que decide su propio punto de rebobinado dentro de SQL.
   * `undefined` si nunca se ejecutó un rebuild, o si no se pudo leer.
   */
  leerCheckpoint(): Promise<Racha3CheckpointSnapshot | undefined>;
}

import { StrategyGroup } from '../../strategy/strategy-group';

/**
 * Foto persistida de los contadores agregados de un canal (oficial o
 * pruebas): exactamente lo mínimo que SummaryReportService necesita para
 * sobrevivir a un reinicio/redeploy sin perder won/lost/alertsSent/uptime
 * acumulados — nunca el detalle de cada Operation (rachas, distribución,
 * martingalas), que sigue viviendo solo en memoria durante la vida del
 * proceso actual.
 *
 * `firstStartedAt` es el instante del primer arranque real del proceso que
 * llegó a persistir este canal: se fija una única vez al crear la fila y
 * nunca se vuelve a escribir después (ver ReportCheckpointStore.save),
 * así `uptimeMs` puede reflejar tiempo acumulado real entre despliegues, no
 * solo desde el último reinicio.
 */
export type ReportCheckpointSnapshot = {
  readonly channel: StrategyGroup;
  readonly won: number;
  readonly lost: number;
  readonly alertsSent: number;
  readonly firstStartedAt: Date;
};

/**
 * Contrato de persistencia del checkpoint de reportes. Hoy solo existe una
 * implementación real (PrismaReportCheckpointStore, infrastructure/persistence/);
 * mismo patrón que OperationReportStore: SummaryReportService solo conoce
 * esta interfaz, nunca Prisma directamente.
 *
 * Ninguna implementación debe lanzar ante un fallo de base de datos: el
 * checkpoint es una optimización de continuidad, nunca una dependencia dura
 * del motor (igual que PrismaService — ver ARCHITECTURE.md). `load` debe
 * devolver `[]` y `save` debe resolver en silencio (logueando internamente)
 * si la persistencia no está disponible.
 */
export interface ReportCheckpointStore {
  /** Un registro por canal que ya tenga checkpoint guardado (0, 1 o 2). */
  loadAll(): Promise<ReadonlyArray<ReportCheckpointSnapshot>>;

  /** Upsert por `channel`: crea la fila la primera vez (fijando
   *  `firstStartedAt`) o actualiza won/lost/alertsSent si ya existía. */
  save(snapshot: ReportCheckpointSnapshot): Promise<void>;
}

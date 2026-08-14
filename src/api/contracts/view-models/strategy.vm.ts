/**
 * Contrato público de `GET /api/v1/strategies`: catálogo estático de qué
 * estrategias existen en código, para un selector en el frontend. El
 * estado de runtime (canal asignado, activo, maxMartingales) no vive
 * acá — eso lo expone `GET /api/v1/channels/:channel`.
 */
export type StrategyVm = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

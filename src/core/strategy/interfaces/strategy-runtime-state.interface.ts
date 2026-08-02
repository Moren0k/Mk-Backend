/**
 * Memoria propia de una Strategy entre evaluaciones sucesivas, aislada por
 * strategyId. No expone nada del resto del sistema (ni Operation, ni
 * historial): es exclusivamente el rincón donde una estrategia puede
 * recordar "ya hice esto antes" sin necesitar un campo mutable propio.
 */
export interface StrategyRuntimeState {
  get<T>(strategyId: string): T | undefined;
  set<T>(strategyId: string, value: T): void;
}

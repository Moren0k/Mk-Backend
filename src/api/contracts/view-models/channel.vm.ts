/**
 * Contrato público de `channels` (Mk-Api.md Anexo A/Anexo D §3/§5,
 * revisado 2026-08-11: `active` es el único interruptor — reemplaza al
 * anterior `alertsEnabled` — y determina si la estrategia asignada
 * evalúa y manda alertas, ambas cosas juntas). Por default (sin ningún
 * `PATCH` todavía): `strategyId: null`, `active: false`,
 * `maxMartingalesOverride: null`.
 */
export type ChannelVm = {
  readonly channel: 'oficial' | 'pruebas';
  readonly strategyId: string | null;
  readonly active: boolean;
  readonly maxMartingalesOverride: number | null;
};

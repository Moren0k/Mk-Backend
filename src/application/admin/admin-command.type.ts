/** Comandos administrativos soportados hoy. Solo RESUMEN existe por ahora. */
export const AdminCommand = {
  RESUMEN: 'RESUMEN',
} as const;

export type AdminCommandRequest = {
  readonly password?: string;
  readonly command?: string;
};

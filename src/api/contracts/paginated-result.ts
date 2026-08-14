/**
 * Marca explícita para que `ResponseEnvelopeInterceptor` sepa cuándo debe
 * sumar `meta` a la respuesta (Mk-Api.md §8.3/§8.4), en vez de envolver
 * la instancia completa como si fuera el `data` mismo. Un controller que
 * no pagina simplemente devuelve su view model tal cual — sin envolverlo
 * en esto.
 */
export class PaginatedResult<T> {
  constructor(
    readonly data: T,
    readonly meta: Readonly<Record<string, unknown>>,
  ) {}
}

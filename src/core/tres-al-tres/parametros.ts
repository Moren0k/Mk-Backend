import { TresAlTresParametros } from './types/tres-al-tres.type';

/**
 * Parámetros de 3al3, fijos en código.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SON VARIABLES DE ENTORNO
 *
 * 3al3 es una estrategia como `streak-3` y `streak-4`: no pide nada al
 * despliegue. `Streak3Strategy` tampoco recibe su longitud de racha ni su
 * `maxMartingales` por `.env` — los lleva dentro. Lo mismo acá.
 *
 * El único interruptor real es el mismo que el del resto del motor:
 * asignarla a un canal activo con `PATCH /api/v1/channels/:channel`. Sin
 * asignar no emite; asignada, emite. No hay un segundo interruptor que
 * pueda quedar desincronizado con el primero.
 *
 * Lo que SÍ es administrable en runtime es `maxMartingales`, por la misma
 * vía que las demás (`StrategyChannelRegistry`), y `escalera` acompaña ese
 * valor: si alguien sube la profundidad por API, la escalera de esta
 * constante deja de describir la apuesta real. Está anotado en `escalera`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE CADA NÚMERO
 *
 * Ninguno es arbitrario. Los tres primeros describen la MESA (cuánto se
 * cobra, cuánto se paga, cuánto cuesta un empate) y de ellos sale el
 * umbral; los otros tres son criterios de calidad de la evidencia.
 */
export const PARAMETROS_3AL3: TresAlTresParametros = Object.freeze({
  /**
   * Importe apostado en cada nivel. Su suma (7) es la pérdida por fallar la
   * escalera completa y su longitud (3) el número de intentos.
   *
   * Debe coincidir con el `maxMartingales` efectivo de la estrategia (2
   * gales = 3 intentos). Si se cambia por API a 3 gales, esta constante
   * queda corta y el umbral calculado sería más bajo que el real: hay que
   * actualizarla aquí en el mismo cambio.
   */
  escalera: Object.freeze([1, 2, 4]),

  /**
   * Fracción del importe que devuelve un empate. 0,9 = devuelve el 90 %, es
   * decir CUESTA el 10 % de lo apostado en ese nivel.
   *
   * Es el parámetro más sensible de todos: los empates son el 11,5 % de las
   * rondas, y ese 10 % mueve el punto de equilibrio de 87,500 % a 87,983 %
   * — más que toda la ventaja del lado del banco. Si la mesa cambiara a
   * devolver el 100 %, cambiar este 0.9 por 1 vuelve la estrategia
   * claramente rentable. Ver `equilibrio.ts`.
   */
  devolucionTie: 0.9,

  /** Ganancia neta de un acierto. 1 = pago 1:1 sin comisión, en los dos lados. */
  pagoAcierto: 1,

  /**
   * Piso adicional del umbral, en la escala del score.
   *
   * 0 significa "manda el punto de equilibrio calculado", que es la única
   * referencia con significado económico. Existe para poder ser MÁS
   * exigente sin tocar la fórmula; nunca menos, porque el umbral efectivo
   * es el mayor de los dos.
   */
  umbralMinimo: 0,

  /**
   * Mínimo de oportunidades resueltas que debe respaldar la condición.
   *
   * El intervalo de Wilson ya castiga la muestra chica por su cuenta, así
   * que esto es un piso duro adicional: por debajo se descarta sin importar
   * el score. Con ~2.100 oportunidades por lado en el histórico, 500 es
   * holgado y solo actúa en un arranque en frío.
   */
  muestraMinima: 500,

  /**
   * Máximas jugadas sin procesar por Analytics antes de considerar que la
   * evidencia no está al día.
   *
   * Con el scheduler cada 60 s y una cadencia de ~33 s por ronda, el rezago
   * normal es de 1-2 jugadas. 50 tolera un par de ticks perdidos sin
   * aceptar evidencia realmente vieja.
   */
  maxRezagoJugadas: 50,

  /**
   * ¿Se exige que la estimación por MODELO supere también el umbral?
   *
   * `false` por decisión explícita del dueño del sistema: decide solo la
   * estimación DIRECTA (los conteos de operaciones resueltas). La del
   * modelo se sigue calculando y queda en el log y en la traza para poder
   * auditarla, pero no bloquea.
   *
   * El riesgo asumido, escrito para que no se olvide: la directa tiene ~9×
   * menos muestra y hoy está 2,2 errores estándar por encima de lo que
   * predice la del modelo, así que puede venir con suerte. Poniéndolo en
   * `true` el sistema vuelve al criterio conservador y, con los datos de
   * hoy, deja de emitir.
   */
  exigirModelo: false,
});

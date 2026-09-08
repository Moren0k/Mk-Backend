import { BadRequestException } from '@nestjs/common';

import type {
  Racha3Entre,
  Racha3Filtros,
  Racha3IntervaloMetrica,
} from '../../../core/analytics/types/racha3-analytics.type';

/**
 * Validación de los parámetros de consulta de Analytics.
 *
 * A mano y con `BadRequestException`, igual que `AdminController` y
 * `ChannelsController`: el proyecto no usa `class-validator` ni un
 * `ValidationPipe` global, y sumar una dependencia para ocho endpoints de
 * lectura sería cambiar una convención establecida por comodidad.
 *
 * Todo parámetro desconocido o mal formado se rechaza con 400 en vez de
 * caer a un default silencioso: un typo en `tipo=PLAYERR` que devolviera
 * el total de ambos lados es peor que un error, porque el cliente creería
 * estar viendo lo que pidió.
 */

/** Cotas de bucket por defecto, las acordadas para todo el dominio. */
export const COTAS_POR_DEFECTO: readonly number[] = [5, 10, 15, 20, 30, 50];

/** Techo de cortes por consulta: más buckets no aportan y sí abultan la respuesta. */
export const MAX_COTAS = 12;
/** Ninguna distancia real se acerca a esto; sirve para rechazar valores absurdos. */
export const MAX_VALOR_COTA = 1_000_000;
/** Tope de la ventana temporal. Acota también el tamaño de la respuesta de por-dia. */
export const MAX_RANGO_DIAS = 366;
export const MAX_UMBRAL_MUESTRA = 100_000;
/** Ventana por defecto de `por-dia` cuando el cliente no acota: última cuarentena. */
export const DIAS_POR_DEFECTO = 90;
export const MAX_LONGITUD_COLUMNA = 50;

const TIPOS: ReadonlySet<string> = new Set(['PLAYER', 'BANKER']);
const METRICAS: ReadonlySet<string> = new Set([
  'jugadas',
  'columnas',
  'segundos',
]);
const ENTRE: ReadonlySet<string> = new Set(['RACHA3', 'PERDIDAS']);

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export function parseTipo(v?: string): 'PLAYER' | 'BANKER' | undefined {
  if (v === undefined || v === '') return undefined;
  if (!TIPOS.has(v)) {
    throw new BadRequestException(
      `"tipo" no válido: "${v}". Valores admitidos: PLAYER, BANKER.`,
    );
  }
  return v as 'PLAYER' | 'BANKER';
}

export function parseMetrica(v?: string): Racha3IntervaloMetrica {
  if (v === undefined || v === '') return 'jugadas';
  if (!METRICAS.has(v)) {
    throw new BadRequestException(
      `"metrica" no válida: "${v}". Valores admitidos: jugadas, columnas, segundos.`,
    );
  }
  return v as Racha3IntervaloMetrica;
}

export function parseEntre(v?: string): Racha3Entre {
  if (v === undefined || v === '') return 'RACHA3';
  if (!ENTRE.has(v)) {
    throw new BadRequestException(
      `"entre" no válido: "${v}". Valores admitidos: RACHA3, PERDIDAS.`,
    );
  }
  return v as Racha3Entre;
}

/**
 * Booleano estricto: sólo "true" o "false". No se acepta "1", "yes" ni la
 * mera presencia del parámetro — `incluir_bloqueadas` cambia el conjunto
 * de datos que se devuelve, y adivinar la intención ahí es peligroso.
 */
export function parseBooleano(
  v: string | undefined,
  nombre: string,
  porDefecto: boolean,
): boolean {
  if (v === undefined || v === '') return porDefecto;
  if (v !== 'true' && v !== 'false') {
    throw new BadRequestException(
      `"${nombre}" debe ser "true" o "false", se recibió "${v}".`,
    );
  }
  return v === 'true';
}

export function parseEntero(
  v: string | undefined,
  nombre: string,
  min: number,
  max: number,
  porDefecto: number,
): number {
  if (v === undefined || v === '') return porDefecto;
  if (!/^-?\d+$/.test(v)) {
    throw new BadRequestException(
      `"${nombre}" debe ser un entero, se recibió "${v}".`,
    );
  }
  const n = Number.parseInt(v, 10);
  if (n < min || n > max) {
    throw new BadRequestException(
      `"${nombre}" debe estar entre ${min} y ${max}, se recibió ${n}.`,
    );
  }
  return n;
}

function parseFecha(v: string | undefined, nombre: string): Date | undefined {
  if (v === undefined || v === '') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(
      `"${nombre}" no es una fecha ISO-8601 válida: "${v}".`,
    );
  }
  return d;
}

export type VentanaTemporal = { desde?: Date; hasta?: Date };

/**
 * `desde`/`hasta` con tope de rango. El tope no protege el motor (el costo
 * de las funciones es prácticamente el mismo con o sin ventana), sino que
 * acota el TAMAÑO de la respuesta de los endpoints por día y rechaza
 * rangos que sólo pueden venir de un error del cliente.
 */
export function parseVentana(
  desdeRaw?: string,
  hastaRaw?: string,
  maxDias: number = MAX_RANGO_DIAS,
): VentanaTemporal {
  const desde = parseFecha(desdeRaw, 'desde');
  const hasta = parseFecha(hastaRaw, 'hasta');

  if (desde && hasta) {
    if (desde.getTime() >= hasta.getTime()) {
      throw new BadRequestException(
        '"desde" debe ser anterior a "hasta" (la ventana es semiabierta: [desde, hasta)).',
      );
    }
    const dias = (hasta.getTime() - desde.getTime()) / MS_POR_DIA;
    if (dias > maxDias) {
      throw new BadRequestException(
        `La ventana no puede superar ${maxDias} días; se pidieron ${Math.ceil(dias)}.`,
      );
    }
  }

  return { desde, hasta };
}

/**
 * Cotas de bucket como CSV. Deben ser enteros positivos ESTRICTAMENTE
 * crecientes: con valores repetidos o desordenados, `racha3_bucket_indice`
 * generaría etiquetas incoherentes (un bucket "8-5") en vez de fallar, y el
 * cliente recibiría una distribución sin sentido en lugar de un error.
 */
export function parseCotas(v?: string): readonly number[] {
  if (v === undefined || v === '') return COTAS_POR_DEFECTO;

  const partes = v.split(',').map((p) => p.trim());
  if (partes.length > MAX_COTAS) {
    throw new BadRequestException(
      `"cotas" admite como máximo ${MAX_COTAS} valores, se recibieron ${partes.length}.`,
    );
  }

  const cotas: number[] = [];
  for (const parte of partes) {
    if (!/^\d+$/.test(parte)) {
      throw new BadRequestException(
        `"cotas" debe ser una lista de enteros separados por coma; "${parte}" no lo es.`,
      );
    }
    const n = Number.parseInt(parte, 10);
    if (n < 1 || n > MAX_VALOR_COTA) {
      throw new BadRequestException(
        `Cada valor de "cotas" debe estar entre 1 y ${MAX_VALOR_COTA}, se recibió ${n}.`,
      );
    }
    cotas.push(n);
  }

  for (let i = 1; i < cotas.length; i++) {
    if (cotas[i] <= cotas[i - 1]) {
      throw new BadRequestException(
        `"cotas" debe ser estrictamente creciente: ${cotas[i - 1]} no es menor que ${cotas[i]}.`,
      );
    }
  }

  return cotas;
}

export type FiltrosCrudos = {
  desde?: string;
  hasta?: string;
  tipo?: string;
  incluir_bloqueadas?: string;
  incluir_integridad_dudosa?: string;
  umbral_muestra?: string;
};

/**
 * Filtros comunes a todos los endpoints de agregación.
 *
 * `incluir_bloqueadas` arranca en `false`: el consumidor natural de estas
 * métricas es el Core, y las oportunidades que el motor real no habría
 * podido operar distorsionarían su lectura. `incluir_integridad_dudosa`
 * arranca en `true` por el criterio opuesto y deliberado: son
 * observaciones reales, y su cantidad viaja siempre en la respuesta.
 */
export function parseFiltros(
  q: FiltrosCrudos,
  maxDias: number = MAX_RANGO_DIAS,
): Racha3Filtros {
  const { desde, hasta } = parseVentana(q.desde, q.hasta, maxDias);

  return {
    desde,
    hasta,
    tipo: parseTipo(q.tipo),
    incluirBloqueadas: parseBooleano(
      q.incluir_bloqueadas,
      'incluir_bloqueadas',
      false,
    ),
    incluirIntegridadDudosa: parseBooleano(
      q.incluir_integridad_dudosa,
      'incluir_integridad_dudosa',
      true,
    ),
    umbralMuestra: parseEntero(
      q.umbral_muestra,
      'umbral_muestra',
      1,
      MAX_UMBRAL_MUESTRA,
      100,
    ),
  };
}

/**
 * Reconstrucción histórica completa del dominio Analytics "Racha 3".
 *
 *   pnpm analytics:rebuild
 *
 * Invoca `analytics_racha3_rebuild()`, que rehace `columnas` y
 * `racha3_operaciones` desde cero a partir de `jugadas`. La tabla `jugadas`
 * NUNCA se modifica: es la única fuente de verdad y todo lo demás es
 * derivado y descartable.
 *
 * Operación poco frecuente y explícita: el régimen normal es el incremental
 * cada 60 s. Un rebuild hace falta cuando cambia la lógica de
 * reconstrucción, cuando cambia el umbral de gap, o cuando el incremental
 * aborta por detectar una inserción retroactiva.
 *
 * Todo ocurre dentro de una única transacción y bajo
 * `pg_advisory_xact_lock(42, 3)`: o queda completo y el checkpoint avanza,
 * o no queda nada.
 */
import { PrismaClient } from '@prisma/client';

type Ejecucion = {
  id: bigint;
  estado: string;
  desde_jugada_id: bigint | null;
  hasta_jugada_id: bigint | null;
  jugadas_leidas: number | null;
  columnas_afectadas: number | null;
  operaciones_afectadas: number | null;
  duracion_ms: number | null;
  error: string | null;
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const umbral = Number.parseInt(
      process.env.ANALYTICS_GAP_MS ?? '120000',
      10,
    );
    console.log(`rebuild de "racha3" (umbral de gap: ${umbral} ms)...`);

    const [ej] = await prisma.$queryRawUnsafe<Ejecucion[]>(
      'SELECT * FROM analytics_racha3_rebuild($1::integer)',
      umbral,
    );

    if (ej.estado !== 'OK') {
      console.error(
        `\nFALLÓ (ejecución ${ej.id}): ${ej.error ?? 'sin mensaje'}`,
      );
      console.error(
        'No se modificó nada: la transacción se revirtió por completo.',
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `\nok  ejecución ${ej.id} · ${ej.duracion_ms} ms\n` +
        `    jugadas leídas:  ${ej.jugadas_leidas}\n` +
        `    rango:           ${ej.desde_jugada_id} .. ${ej.hasta_jugada_id}\n` +
        `    columnas:        ${ej.columnas_afectadas}\n` +
        `    oportunidades:   ${ej.operaciones_afectadas}`,
    );
    console.log('\nSiguiente paso recomendado: pnpm analytics:verify');
  } finally {
    await prisma.$disconnect();
  }
}

void main();

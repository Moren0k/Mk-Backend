-- =====================================================================
-- F2 - Motor de procesamiento de Analytics "Racha 3".
--
-- Tres funciones públicas y una interna:
--
--   analytics_racha3_reconstruir()  (interna) reconstruye columnas y
--                                   oportunidades desde una jugada dada.
--                                   Asume que el tramo ya fue borrado.
--   analytics_racha3_rebuild()      TRUNCATE + reconstruir todo.
--   analytics_racha3_incremental()  DELETE del tramo rebobinado + reconstruir.
--   analytics_racha3_validar()      invariantes V0-V11, sin efectos.
--
-- Decisiones de F2 (aprobadas 2026-09-07):
--
--  * DELETE + INSERT sobre el tramo rebobinado, no UPSERT. Prioridad
--    declarada: corrección y simplicidad. Los ids de `columnas` y
--    `racha3_operaciones` son EFÍMEROS y nadie fuera de este dominio debe
--    tratarlos como identidad; a cambio, un gap recién descubierto que
--    parte una columna en dos se maneja sin ningún caso especial, porque el
--    tramo se reconstruye entero desde cero.
--
--  * Sin límite artificial de jugadas hacia adelante. El `LIMIT 3` que
--    aparece abajo NO es una ventana de búsqueda: es la cantidad exacta de
--    puntos de decisión que tiene la martingala (directa, MG1, MG2). Los
--    TIE intercalados entre esos tres puntos son ilimitados, y se cuentan
--    aparte por diferencia de ids. Una operación puede abarcar cualquier
--    cantidad de jugadas.
--
--  * Rebobinado = la MENOR entre el inicio de la última columna y el inicio
--    de la columna de la operación PENDIENTE más antigua. Ambos son inicios
--    de columna, así que el tramo siempre arranca en una frontera limpia.
--
--  * Todo corre bajo pg_advisory_xact_lock(42, 3) y en una sola
--    transacción: o avanza el checkpoint y quedan los datos, o no queda
--    nada. Nunca un estado intermedio.
--
--  * Umbral de gap: 120000 ms, como parámetro con default, nunca hardcode.
--  * Zona horaria: 'America/Bogota', siempre por nombre.
-- =====================================================================


-- ---------------------------------------------------------------------
-- analytics_racha3_reconstruir - núcleo compartido.
--
-- Reconstruye columnas y oportunidades a partir de `p_desde` (inclusive).
-- NO borra nada: quien llama es responsable de haber dejado el tramo
-- limpio. NO toca el checkpoint ni la bitácora.
--
-- `p_desde` debe ser el inicio de una columna. La función lo verifica de
-- forma indirecta (invariante de cobertura al final) y aborta si no lo es.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_racha3_reconstruir(
    p_desde           bigint,
    p_umbral_ms       integer,
    p_max_martingalas smallint,
    OUT columnas_afectadas    integer,
    OUT operaciones_afectadas integer
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_umbral      interval := make_interval(secs => (p_umbral_ms / 1000.0)::double precision);
    v_esperadas   bigint;
    v_cubiertas   bigint;
    -- Cota superior para las operaciones que quedan PENDIENTE. Se resuelve
    -- una sola vez y se usa como límite CONCRETO del rango: ver el conteo de
    -- `evaluadas` más abajo.
    v_max_id      bigint;
BEGIN
    SELECT max(id) INTO v_max_id FROM jugadas;
    -- =============== 1) COLUMNAS ===============
    -- Gaps-and-islands con corte adicional por discontinuidad temporal.
    -- Se incluye la jugada inmediatamente ANTERIOR al tramo (fila de
    -- contexto) con el único fin de poder calcular el gap y el cambio de
    -- ganador en la primera fila del tramo. Esa fila jamás se inserta:
    -- queda descartada por el filtro `ini_id >= p_desde`, que es correcto
    -- precisamente porque `p_desde` es un inicio de columna (si no lo
    -- fuera, la fila de contexto compartiría grupo con el tramo y la
    -- verificación de cobertura del final abortaría).
    WITH base AS (
        SELECT id, ganador, jugada_en
        FROM (
            SELECT id, ganador, jugada_en FROM jugadas WHERE id < p_desde ORDER BY id DESC LIMIT 1
        ) ctx
        UNION ALL
        SELECT id, ganador, jugada_en FROM jugadas WHERE id >= p_desde
    ),
    marcada AS (
        SELECT id, ganador, jugada_en,
               lag(ganador)   OVER w AS prev_g,
               lag(jugada_en) OVER w AS prev_en
        FROM base
        WINDOW w AS (ORDER BY id)
    ),
    flags AS (
        SELECT id, ganador, jugada_en,
               (prev_en IS NOT NULL AND jugada_en - prev_en > v_umbral) AS gap_antes,
               (prev_g IS NULL
                OR ganador <> prev_g
                OR jugada_en - prev_en > v_umbral)                      AS inicia
        FROM marcada
    ),
    grupos AS (
        SELECT id, ganador, jugada_en, gap_antes, inicia,
               count(*) FILTER (WHERE inicia) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) AS grupo
        FROM flags
    ),
    agrupada AS (
        SELECT grupo,
               -- Dentro de un grupo `ganador` es constante por construcción;
               -- min() es sólo la forma de proyectarlo bajo GROUP BY.
               min(ganador)      AS tipo,
               count(*)::integer AS longitud,
               min(id)           AS ini_id,
               max(id)           AS fin_id,
               min(jugada_en)    AS ini_en,
               max(jugada_en)    AS fin_en,
               -- Sólo la primera fila del grupo tiene `inicia`, así que esto
               -- proyecta exactamente su `gap_antes`.
               bool_or(gap_antes AND inicia) AS corte_por_gap
        FROM grupos
        GROUP BY grupo
    ),
    en_rango AS (
        SELECT * FROM agrupada WHERE ini_id >= p_desde
    )
    INSERT INTO columnas (
        tipo, longitud, inicio_jugada_id, fin_jugada_id,
        inicio_en, fin_en, corte_por_gap, cerrada_por_gap
    )
    SELECT tipo, longitud, ini_id, fin_id, ini_en, fin_en, corte_por_gap,
           -- Una columna "termina en gap" si la SIGUIENTE empieza por gap.
           -- La última del tramo queda en false: no hay jugada posterior
           -- todavía, y la próxima corrida incremental la reconstruirá.
           COALESCE(lead(corte_por_gap) OVER (ORDER BY ini_id), false)
    FROM en_rango
    ORDER BY ini_id;

    GET DIAGNOSTICS columnas_afectadas = ROW_COUNT;

    -- Verificación de cobertura: las columnas insertadas deben cubrir
    -- EXACTAMENTE las jugadas del tramo, ni una más ni una menos. Es lo que
    -- detecta un `p_desde` que no fuese inicio de columna (la fila de
    -- contexto habría absorbido jugadas del tramo en su propio grupo).
    SELECT count(*) INTO v_esperadas FROM jugadas WHERE id >= p_desde;
    SELECT COALESCE(sum(longitud), 0) INTO v_cubiertas
    FROM columnas WHERE inicio_jugada_id >= p_desde;

    IF v_esperadas <> v_cubiertas THEN
        RAISE EXCEPTION
            'Cobertura de columnas inconsistente desde la jugada %: % jugadas en el tramo, % cubiertas. '
            '¿`p_desde` no era el inicio de una columna?', p_desde, v_esperadas, v_cubiertas;
    END IF;

    -- La columna anterior (que NO se borró) termina en gap si y sólo si la
    -- primera columna nueva empieza por gap. Se recalcula en vez de darlo
    -- por bueno: es una sola fila y elimina toda una clase de razonamiento
    -- sobre qué sobrevivió del run anterior.
    UPDATE columnas c
    SET cerrada_por_gap = n.corte_por_gap
    FROM (
        SELECT corte_por_gap FROM columnas
        WHERE inicio_jugada_id >= p_desde ORDER BY inicio_jugada_id LIMIT 1
    ) n
    WHERE c.inicio_jugada_id = (
        SELECT max(inicio_jugada_id) FROM columnas WHERE inicio_jugada_id < p_desde
    );

    -- =============== 2) OPORTUNIDADES ===============
    -- Filtro POSITIVO sobre el tipo: `tipo IN ('PLAYER','BANKER')`, nunca
    -- `tipo <> 'TIE'`. Si Tipminer introdujera un valor nuevo, esto lo
    -- ignora en vez de fabricar oportunidades inexistentes (V0 lo detecta).
    INSERT INTO racha3_operaciones (
        columna_id, tipo_racha, apuesta,
        jugada_inicio_id, jugada_confirmacion_id,
        jugada_directa_id, jugada_mg1_id, jugada_mg2_id, jugada_resolucion_id,
        inicio_en, confirmacion_en, resuelta_en,
        estado, resultado_final, max_martingalas,
        duracion_ms, jugadas_evaluadas, ties_en_operacion,
        hora_col_inicio, hora_col_confirmacion, hora_col_resolucion,
        procesada_en
    )
    SELECT
        c.id,
        c.tipo,
        d.apuesta,
        c.inicio_jugada_id,
        conf.id,
        CASE WHEN d.niveles >= 1 THEN d.ids[1] END,
        CASE WHEN d.niveles >= 2 THEN d.ids[2] END,
        CASE WHEN d.niveles >= 3 THEN d.ids[3] END,
        d.resol_id,
        c.inicio_en,
        conf.jugada_en,
        d.resol_en,
        CASE WHEN d.resultado IS NULL THEN 'PENDIENTE' ELSE 'RESUELTA' END,
        d.resultado,
        p_max_martingalas,
        CASE WHEN d.resol_en IS NOT NULL
             THEN (EXTRACT(epoch FROM d.resol_en - conf.jugada_en) * 1000)::bigint END,
        d.evaluadas,
        d.evaluadas - d.niveles,
        EXTRACT(hour FROM c.inicio_en   AT TIME ZONE 'America/Bogota')::smallint,
        EXTRACT(hour FROM conf.jugada_en AT TIME ZONE 'America/Bogota')::smallint,
        CASE WHEN d.resol_en IS NOT NULL
             THEN EXTRACT(hour FROM d.resol_en AT TIME ZONE 'America/Bogota')::smallint END,
        clock_timestamp()
    FROM columnas c

    -- La 3.a jugada de la corrida: la confirmación.
    CROSS JOIN LATERAL (
        SELECT j.id, j.jugada_en
        FROM jugadas j
        WHERE j.id >= c.inicio_jugada_id AND j.id <= c.fin_jugada_id
        ORDER BY j.id
        OFFSET 2 LIMIT 1
    ) conf

    -- Los (hasta) 3 puntos de decisión de la martingala: las primeras tres
    -- jugadas PLAYER/BANKER posteriores a la confirmación. Los TIE que
    -- haya entre medio son neutrales e ilimitados; se recuperan después por
    -- diferencia contra `evaluadas`.
    CROSS JOIN LATERAL (
        SELECT
            dd.apuesta,
            dd.ids,
            dd.niveles,
            dd.resultado,
            CASE WHEN dd.resultado IS NOT NULL THEN dd.ids[dd.niveles] END AS resol_id,
            CASE WHEN dd.resultado IS NOT NULL
                 THEN (SELECT j2.jugada_en FROM jugadas j2 WHERE j2.id = dd.ids[dd.niveles]) END AS resol_en,
            -- El límite superior SIEMPRE es un id concreto, nunca un
            -- `OR ... IS NULL`. Con el OR, PostgreSQL no puede usar el
            -- índice de `jugadas` como rango y termina escaneando todas las
            -- jugadas posteriores a la confirmación para CADA oportunidad
            -- (~42k x 4.100 = 172M filas: excede el statement_timeout de
            -- 2 min). Con la cota concreta es un index range scan de unas
            -- pocas filas.
            (SELECT count(*)::integer FROM jugadas j3
              WHERE j3.id > conf.id
                AND j3.id <= COALESCE(dd.ids[dd.niveles], v_max_id)) AS evaluadas
        FROM (
            SELECT
                x.apuesta, x.ids, x.gs, x.n,
                CASE
                    WHEN x.n >= 1 AND x.gs[1] = x.apuesta THEN 'DIRECTA'
                    WHEN x.n >= 2 AND x.gs[2] = x.apuesta THEN 'MG1'
                    WHEN x.n >= 3 AND x.gs[3] = x.apuesta THEN 'MG2'
                    WHEN x.n >= 3                         THEN 'LOSS'
                END AS resultado,
                -- Niveles de martingala realmente consumidos. Si la
                -- operación sigue abierta, son todos los vistos hasta ahora
                -- (todos fueron pérdidas, por definición de seguir abierta).
                CASE
                    WHEN x.n >= 1 AND x.gs[1] = x.apuesta THEN 1
                    WHEN x.n >= 2 AND x.gs[2] = x.apuesta THEN 2
                    WHEN x.n >= 3                         THEN 3
                    ELSE x.n
                END AS niveles
            FROM (
                SELECT
                    CASE c.tipo WHEN 'PLAYER' THEN 'BANKER' ELSE 'PLAYER' END AS apuesta,
                    COALESCE(dec.ids, ARRAY[]::bigint[]) AS ids,
                    COALESCE(dec.gs,  ARRAY[]::text[])   AS gs,
                    COALESCE(array_length(dec.ids, 1), 0) AS n
                FROM (
                    SELECT array_agg(k.id ORDER BY k.id) AS ids,
                           array_agg(k.ganador ORDER BY k.id) AS gs
                    FROM (
                        SELECT j.id, j.ganador
                        FROM jugadas j
                        WHERE j.id > conf.id AND j.ganador IN ('PLAYER', 'BANKER')
                        ORDER BY j.id
                        LIMIT 3
                    ) k
                ) dec
            ) x
        ) dd
    ) d

    WHERE c.inicio_jugada_id >= p_desde
      AND c.tipo IN ('PLAYER', 'BANKER')
      AND c.longitud >= 3
    ORDER BY conf.id;

    GET DIAGNOSTICS operaciones_afectadas = ROW_COUNT;

    -- =============== 3) DERIVADOS ===============
    -- Se leen TODAS las oportunidades (la ventana necesita la anterior al
    -- tramo) pero sólo se actualizan las del tramo, para no reescribir
    -- 4.100 filas en cada tick de 60 s.
    -- MATERIALIZED es obligatorio, no cosmético: sin él PostgreSQL puede
    -- inlinar este CTE dentro del EXISTS correlacionado de más abajo y
    -- reevaluar la ventana sobre las 42k jugadas una vez POR OPERACIÓN.
    -- Materializado son 19 filas y el EXISTS es trivial.
    WITH gaps AS MATERIALIZED (
        SELECT id FROM (
            SELECT id, jugada_en - lag(jugada_en) OVER (ORDER BY id) AS delta
            FROM jugadas
        ) g
        WHERE delta > v_umbral
    ),
    ord AS (
        SELECT
            o.id,
            o.jugada_confirmacion_id AS conf_id,
            o.confirmacion_en,
            o.jugada_resolucion_id,
            c.inicio_jugada_id AS col_ini,
            c.corte_por_gap,
            lag(o.jugada_confirmacion_id) OVER w AS prev_conf,
            lag(o.confirmacion_en)        OVER w AS prev_conf_en,
            lag(o.jugada_resolucion_id)   OVER w AS prev_resol,
            lag(o.estado)                 OVER w AS prev_estado,
            lag(c.inicio_jugada_id)       OVER w AS prev_col_ini
        FROM racha3_operaciones o
        JOIN columnas c ON c.id = o.columna_id
        WINDOW w AS (ORDER BY o.jugada_confirmacion_id)
    )
    UPDATE racha3_operaciones r SET
        jugadas_desde_anterior = CASE WHEN ord.prev_conf IS NOT NULL THEN
            (SELECT count(*)::integer FROM jugadas j
              WHERE j.id > ord.prev_conf AND j.id <= ord.conf_id) END,
        columnas_desde_anterior = CASE WHEN ord.prev_col_ini IS NOT NULL THEN
            (SELECT count(*)::integer FROM columnas cc
              WHERE cc.inicio_jugada_id > ord.prev_col_ini
                AND cc.inicio_jugada_id <= ord.col_ini) END,
        -- trunc() explícito, NO el redondeo implícito de `::integer`.
        -- `jugada_en` tiene precisión de milisegundos, así que un intervalo
        -- de 723,6 s redondearía a 724 mientras cualquier consumidor que
        -- trunque obtendría 723. Se fija la semántica en "segundos completos
        -- transcurridos"; la precisión exacta sigue disponible en
        -- `duracion_ms` y en los propios timestamptz.
        segundos_desde_anterior = CASE WHEN ord.prev_conf_en IS NOT NULL THEN
            trunc(EXTRACT(epoch FROM ord.confirmacion_en - ord.prev_conf_en))::integer END,
        -- El motor real no habría podido alertar aquí: en el instante de la
        -- confirmación seguía abierta la operación anterior. Si la anterior
        -- quedó PENDIENTE, por definición sigue abierta.
        bloqueada_por_operacion_previa =
            (ord.prev_conf IS NOT NULL
             AND (ord.prev_estado = 'PENDIENTE' OR ord.conf_id <= ord.prev_resol)),
        -- Faltan rondas reales dentro de la ventana de esta oportunidad:
        -- o la corrida arranca justo después de un hueco, o hay un hueco
        -- entre el inicio de la corrida y la resolución.
        integridad_ok = NOT (
            ord.corte_por_gap
            OR EXISTS (
                SELECT 1 FROM gaps
                WHERE gaps.id > ord.col_ini
                  AND gaps.id <= COALESCE(ord.jugada_resolucion_id, v_max_id)
            )
        )
    FROM ord
    WHERE r.id = ord.id
      AND r.jugada_confirmacion_id >= p_desde;
END;
$$;

COMMENT ON FUNCTION analytics_racha3_reconstruir(bigint, integer, smallint) IS
    'Núcleo compartido por rebuild e incremental: reconstruye columnas y oportunidades '
    'Racha 3 desde una jugada dada. No borra nada, no toca el checkpoint ni la bitácora.';


-- ---------------------------------------------------------------------
-- analytics_racha3_rebuild - reconstrucción histórica completa.
--
-- `jugadas` NUNCA se modifica. Todo lo demás se rehace desde cero.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_racha3_rebuild(
    p_umbral_ms       integer  DEFAULT 120000,
    p_max_martingalas smallint DEFAULT 2::smallint
)
RETURNS analytics_ejecuciones
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_t0      timestamptz := clock_timestamp();
    v_error   text;
    v_cols    integer;
    v_ops     integer;
    v_desde   bigint;
    v_hasta   bigint;
    v_hasta_en timestamptz;
    v_leidas  integer;
    v_ej      analytics_ejecuciones;
BEGIN
    PERFORM pg_advisory_xact_lock(42, 3);

    -- Subtransacción: si algo falla, el trabajo se revierte hasta este
    -- savepoint pero la bitácora de más abajo sí se escribe.
    BEGIN
        TRUNCATE racha3_operaciones, columnas RESTART IDENTITY;

        SELECT min(id), max(id), count(*)::integer INTO v_desde, v_hasta, v_leidas FROM jugadas;

        IF v_desde IS NULL THEN
            v_cols := 0;
            v_ops  := 0;
            DELETE FROM analytics_checkpoints WHERE proceso = 'racha3';
        ELSE
            SELECT jugada_en INTO v_hasta_en FROM jugadas WHERE id = v_hasta;

            SELECT r.columnas_afectadas, r.operaciones_afectadas INTO v_cols, v_ops
            FROM analytics_racha3_reconstruir(v_desde, p_umbral_ms, p_max_martingalas) r;

            INSERT INTO analytics_checkpoints (
                proceso, ultima_jugada_id, ultima_jugada_en,
                reproceso_desde_jugada_id, actualizado_en
            )
            VALUES (
                'racha3', v_hasta, v_hasta_en,
                analytics_racha3_rebobinado(), clock_timestamp()
            )
            ON CONFLICT (proceso) DO UPDATE SET
                ultima_jugada_id          = EXCLUDED.ultima_jugada_id,
                ultima_jugada_en          = EXCLUDED.ultima_jugada_en,
                reproceso_desde_jugada_id = EXCLUDED.reproceso_desde_jugada_id,
                ultima_ejecucion_id       = NULL,
                actualizado_en            = EXCLUDED.actualizado_en;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        v_cols := NULL;
        v_ops  := NULL;
    END;

    INSERT INTO analytics_ejecuciones (
        proceso, tipo, estado, desde_jugada_id, hasta_jugada_id,
        jugadas_leidas, columnas_afectadas, operaciones_afectadas,
        duracion_ms, error, iniciado_en, terminado_en
    )
    VALUES (
        'racha3', 'REBUILD',
        CASE WHEN v_error IS NULL THEN 'OK' ELSE 'ERROR' END,
        v_desde, v_hasta,
        CASE WHEN v_error IS NULL THEN v_leidas END,
        v_cols, v_ops,
        (EXTRACT(epoch FROM clock_timestamp() - v_t0) * 1000)::integer,
        v_error, v_t0, clock_timestamp()
    )
    RETURNING * INTO v_ej;

    IF v_error IS NULL THEN
        UPDATE analytics_checkpoints SET ultima_ejecucion_id = v_ej.id WHERE proceso = 'racha3';
    END IF;

    RETURN v_ej;
END;
$$;


-- ---------------------------------------------------------------------
-- analytics_racha3_rebobinado - punto de rebobinado seguro.
--
-- La MENOR entre el inicio de la última columna (siempre extensible) y el
-- inicio de la columna de la operación PENDIENTE más antigua (hay que poder
-- reevaluarla). Ambos son inicios de columna, así que el tramo siempre
-- arranca en una frontera limpia.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_racha3_rebobinado()
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT LEAST(
        (SELECT max(inicio_jugada_id) FROM columnas),
        COALESCE(
            (SELECT min(c.inicio_jugada_id)
               FROM racha3_operaciones o
               JOIN columnas c ON c.id = o.columna_id
              WHERE o.estado = 'PENDIENTE'),
            (SELECT max(inicio_jugada_id) FROM columnas)
        )
    );
$$;


-- ---------------------------------------------------------------------
-- analytics_racha3_incremental - procesa sólo lo nuevo.
--
-- Recorre desde el punto de rebobinado, SIEMPRE con `id >= …ORDER BY id`,
-- nunca con `BETWEEN` (`jugadas.id` no es contiguo).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_racha3_incremental(
    p_umbral_ms       integer  DEFAULT 120000,
    p_max_martingalas smallint DEFAULT 2::smallint
)
RETURNS analytics_ejecuciones
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_t0         timestamptz := clock_timestamp();
    v_error      text;
    v_cols       integer;
    v_ops        integer;
    v_desde      bigint;
    v_hasta      bigint;
    v_hasta_en   timestamptz;
    v_leidas     integer;
    v_cp         analytics_checkpoints;
    v_sin_nada   boolean := false;
    v_ej         analytics_ejecuciones;
BEGIN
    PERFORM pg_advisory_xact_lock(42, 3);

    BEGIN
        SELECT * INTO v_cp FROM analytics_checkpoints WHERE proceso = 'racha3';

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'No hay checkpoint para "racha3": ejecutá analytics_racha3_rebuild() primero.';
        END IF;

        -- Guardia de retroactividad: el orden por id sólo es cronológico
        -- mientras haya un único escritor. Si aparece una jugada con id
        -- mayor pero instante anterior, todo el procesamiento incremental
        -- deja de ser válido y hay que rehacer el histórico.
        IF EXISTS (
            SELECT 1 FROM jugadas
            WHERE id > v_cp.ultima_jugada_id AND jugada_en < v_cp.ultima_jugada_en
        ) THEN
            RAISE EXCEPTION
                'Inserción retroactiva detectada después de la jugada % (%): el orden por id dejó '
                'de ser cronológico. Se requiere analytics_racha3_rebuild().',
                v_cp.ultima_jugada_id, v_cp.ultima_jugada_en;
        END IF;

        SELECT max(id) INTO v_hasta FROM jugadas;

        -- Sin jugadas nuevas no se toca absolutamente nada: reejecutar el
        -- tick es un no-op estricto, no una reescritura idéntica.
        IF v_hasta IS NULL OR v_hasta <= v_cp.ultima_jugada_id THEN
            v_sin_nada := true;
            v_desde    := NULL;
            v_hasta    := v_cp.ultima_jugada_id;
            v_leidas   := 0;
            v_cols     := 0;
            v_ops      := 0;
        ELSE
            v_desde := v_cp.reproceso_desde_jugada_id;

            SELECT count(*)::integer INTO v_leidas FROM jugadas WHERE id >= v_desde;
            SELECT jugada_en INTO v_hasta_en FROM jugadas WHERE id = v_hasta;

            -- DELETE + INSERT del tramo. El CASCADE de la FK se lleva las
            -- oportunidades de esas columnas; el tramo se reconstruye
            -- entero, así que un gap recién descubierto que parta una
            -- columna no necesita ningún caso especial.
            DELETE FROM columnas WHERE inicio_jugada_id >= v_desde;

            SELECT r.columnas_afectadas, r.operaciones_afectadas INTO v_cols, v_ops
            FROM analytics_racha3_reconstruir(v_desde, p_umbral_ms, p_max_martingalas) r;

            UPDATE analytics_checkpoints SET
                ultima_jugada_id          = v_hasta,
                ultima_jugada_en          = v_hasta_en,
                reproceso_desde_jugada_id = analytics_racha3_rebobinado(),
                actualizado_en            = clock_timestamp()
            WHERE proceso = 'racha3';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        v_cols := NULL;
        v_ops  := NULL;
    END;

    INSERT INTO analytics_ejecuciones (
        proceso, tipo, estado, desde_jugada_id, hasta_jugada_id,
        jugadas_leidas, columnas_afectadas, operaciones_afectadas,
        duracion_ms, error, iniciado_en, terminado_en
    )
    VALUES (
        'racha3', 'INCREMENTAL',
        CASE WHEN v_error IS NULL THEN 'OK' ELSE 'ERROR' END,
        v_desde, v_hasta,
        CASE WHEN v_error IS NULL THEN v_leidas END,
        v_cols, v_ops,
        (EXTRACT(epoch FROM clock_timestamp() - v_t0) * 1000)::integer,
        v_error, v_t0, clock_timestamp()
    )
    RETURNING * INTO v_ej;

    IF v_error IS NULL AND NOT v_sin_nada THEN
        UPDATE analytics_checkpoints SET ultima_ejecucion_id = v_ej.id WHERE proceso = 'racha3';
    END IF;

    RETURN v_ej;
END;
$$;


-- ---------------------------------------------------------------------
-- analytics_racha3_validar - invariantes V0..V11.
--
-- Sin efectos secundarios. Devuelve una fila por invariante con `ok` y, si
-- falla, cuántos casos y un ejemplo. Todo lo que aquí se comprueba es
-- precisamente lo que un CHECK no puede: relaciones entre filas y entre
-- tablas, y coherencia contra los datos reales de `jugadas`.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_racha3_validar(
    p_umbral_ms integer DEFAULT 120000
)
RETURNS TABLE (invariante text, descripcion text, ok boolean, fallos bigint, ejemplo text)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_umbral interval := make_interval(secs => (p_umbral_ms / 1000.0)::double precision);
    v_max_id bigint;
BEGIN
    SELECT max(id) INTO v_max_id FROM jugadas;
    -- V0: el vocabulario de `ganador` sigue siendo el esperado. Si Tipminer
    -- introduce un valor nuevo, el filtro positivo lo ignora en silencio,
    -- así que hace falta que algo lo grite.
    RETURN QUERY
    SELECT 'V0', 'jugadas.ganador solo contiene PLAYER/BANKER/TIE',
           count(*) = 0, count(*),
           min(ganador)
    FROM jugadas WHERE ganador NOT IN ('PLAYER', 'BANKER', 'TIE');

    -- V1: las columnas cubren exactamente el historial.
    RETURN QUERY
    SELECT 'V1', 'sum(columnas.longitud) = count(jugadas)',
           COALESCE((SELECT sum(longitud) FROM columnas), 0) = (SELECT count(*) FROM jugadas),
           abs(COALESCE((SELECT sum(longitud) FROM columnas), 0) - (SELECT count(*) FROM jugadas)),
           format('columnas=%s jugadas=%s',
                  COALESCE((SELECT sum(longitud) FROM columnas), 0), (SELECT count(*) FROM jugadas));

    -- V2: contiguas, sin solapes ni huecos, y la longitud declarada es real.
    RETURN QUERY
    WITH c AS (
        SELECT id, inicio_jugada_id, fin_jugada_id, longitud,
               lead(inicio_jugada_id) OVER (ORDER BY inicio_jugada_id) AS sig_ini
        FROM columnas
    ),
    malas AS (
        SELECT c.id,
               (SELECT count(*) FROM jugadas j
                 WHERE j.id >= c.inicio_jugada_id AND j.id <= c.fin_jugada_id) AS reales,
               c.longitud,
               (SELECT min(j.id) FROM jugadas j WHERE j.id > c.fin_jugada_id) AS sig_jugada,
               c.sig_ini
        FROM c
    )
    SELECT 'V2', 'columnas contiguas, sin solapes ni huecos, longitud real',
           count(*) = 0, count(*),
           min(format('columna %s: longitud=%s reales=%s sig_ini=%s sig_jugada=%s',
                      id, longitud, reales, sig_ini, sig_jugada))
    FROM malas
    WHERE reales <> longitud OR (sig_ini IS NOT NULL AND sig_ini <> sig_jugada);

    -- V3: dos columnas adyacentes del mismo tipo SOLO si la segunda empieza
    -- por gap. Es la consecuencia deliberada de no fusionar a través de un
    -- hueco temporal.
    RETURN QUERY
    WITH c AS (
        SELECT inicio_jugada_id, tipo, corte_por_gap,
               lag(tipo) OVER (ORDER BY inicio_jugada_id) AS tipo_prev
        FROM columnas
    )
    SELECT 'V3', 'adyacentes del mismo tipo solo con corte_por_gap',
           count(*) = 0, count(*),
           min(format('columna que inicia en jugada %s', inicio_jugada_id))
    FROM c WHERE tipo = tipo_prev AND NOT corte_por_gap;

    -- V4: cerrada_por_gap coherente con el corte_por_gap de la siguiente.
    RETURN QUERY
    WITH c AS (
        SELECT inicio_jugada_id, cerrada_por_gap,
               lead(corte_por_gap) OVER (ORDER BY inicio_jugada_id) AS sig_corte
        FROM columnas
    )
    SELECT 'V4', 'cerrada_por_gap = corte_por_gap de la siguiente',
           count(*) = 0, count(*),
           min(format('columna que inicia en jugada %s', inicio_jugada_id))
    FROM c WHERE cerrada_por_gap <> COALESCE(sig_corte, false);

    -- V5: el tipo declarado coincide con el ganador real de TODAS sus
    -- jugadas, y ninguna jugada interna rompe el umbral de gap.
    RETURN QUERY
    WITH gaps AS MATERIALIZED (
        SELECT id FROM (
            SELECT id, jugada_en - lag(jugada_en) OVER (ORDER BY id) AS delta FROM jugadas
        ) g WHERE delta > v_umbral
    )
    SELECT 'V5', 'columnas.tipo = ganador real de todas sus jugadas, sin gaps internos',
           count(*) = 0, count(*),
           min(format('columna %s', c.id))
    FROM columnas c
    WHERE EXISTS (
        SELECT 1 FROM jugadas j
        WHERE j.id >= c.inicio_jugada_id AND j.id <= c.fin_jugada_id AND j.ganador <> c.tipo
    )
    OR EXISTS (
        SELECT 1 FROM gaps
        WHERE gaps.id > c.inicio_jugada_id AND gaps.id <= c.fin_jugada_id
    );

    -- V6: existe exactamente una oportunidad por columna elegible, y
    -- ninguna por columna no elegible.
    RETURN QUERY
    SELECT 'V6', 'una Racha 3 por columna PLAYER/BANKER de longitud>=3, y solo por esas',
           count(*) = 0, count(*),
           min(format('columna %s (tipo=%s longitud=%s ops=%s)', c.id, c.tipo, c.longitud, n))
    FROM (
        SELECT c.*, (SELECT count(*) FROM racha3_operaciones o WHERE o.columna_id = c.id) AS n
        FROM columnas c
    ) c
    WHERE n <> CASE WHEN c.tipo IN ('PLAYER', 'BANKER') AND c.longitud >= 3 THEN 1 ELSE 0 END;

    -- V7: anclaje correcto a la columna y a las jugadas.
    RETURN QUERY
    SELECT 'V7', 'inicio/confirmacion/tipo/apuesta anclados correctamente a la columna',
           count(*) = 0, count(*),
           min(format('operacion %s', o.id))
    FROM racha3_operaciones o
    JOIN columnas c ON c.id = o.columna_id
    WHERE o.tipo_racha <> c.tipo
       OR o.jugada_inicio_id <> c.inicio_jugada_id
       OR o.inicio_en <> c.inicio_en
       OR o.jugada_confirmacion_id <> (
            SELECT j.id FROM jugadas j
            WHERE j.id >= c.inicio_jugada_id AND j.id <= c.fin_jugada_id
            ORDER BY j.id OFFSET 2 LIMIT 1)
       OR o.apuesta <> CASE c.tipo WHEN 'PLAYER' THEN 'BANKER' ELSE 'PLAYER' END;

    -- V8: la escalera apunta exactamente a las primeras N jugadas
    -- PLAYER/BANKER posteriores a la confirmación, en orden.
    RETURN QUERY
    WITH esperado AS (
        SELECT o.id,
               ARRAY(
                   SELECT j.id FROM jugadas j
                   WHERE j.id > o.jugada_confirmacion_id AND j.ganador IN ('PLAYER', 'BANKER')
                   ORDER BY j.id LIMIT 3
               ) AS ids,
               array_remove(
                   ARRAY[o.jugada_directa_id, o.jugada_mg1_id, o.jugada_mg2_id], NULL
               ) AS reales
        FROM racha3_operaciones o
    )
    SELECT 'V8', 'la escalera son las primeras N jugadas PLAYER/BANKER tras la confirmacion',
           count(*) = 0, count(*),
           min(format('operacion %s: reales=%s esperado=%s', id, reales, ids))
    FROM esperado
    WHERE reales <> ids[1:array_length(reales, 1)];

    -- V9: el resultado coincide con los ganadores REALES de las jugadas
    -- apuntadas: todos los niveles previos perdieron, y el último ganó
    -- salvo que sea LOSS.
    RETURN QUERY
    WITH g AS (
        SELECT o.id, o.apuesta, o.resultado_final, o.estado,
               (SELECT ganador FROM jugadas WHERE id = o.jugada_directa_id) AS g1,
               (SELECT ganador FROM jugadas WHERE id = o.jugada_mg1_id)     AS g2,
               (SELECT ganador FROM jugadas WHERE id = o.jugada_mg2_id)     AS g3
        FROM racha3_operaciones o
    )
    SELECT 'V9', 'resultado_final coherente con los ganadores reales de la escalera',
           count(*) = 0, count(*),
           min(format('operacion %s (%s): %s/%s/%s vs apuesta %s', id, resultado_final, g1, g2, g3, apuesta))
    FROM g
    WHERE NOT (
        CASE resultado_final
            WHEN 'DIRECTA' THEN g1 = apuesta
            WHEN 'MG1'     THEN g1 <> apuesta AND g2 = apuesta
            WHEN 'MG2'     THEN g1 <> apuesta AND g2 <> apuesta AND g3 = apuesta
            WHEN 'LOSS'    THEN g1 <> apuesta AND g2 <> apuesta AND g3 <> apuesta
            ELSE estado = 'PENDIENTE'
                 AND COALESCE(g1 <> apuesta, true)
                 AND COALESCE(g2 <> apuesta, true)
                 AND COALESCE(g3 <> apuesta, true)
        END
    );

    -- V10: las horas Colombia son exactamente las derivadas de los
    -- timestamptz. Es la única forma de detectar que alguien las escribió a
    -- mano o con aritmética de offsets.
    RETURN QUERY
    SELECT 'V10', 'hora_col_* derivadas de timestamptz AT TIME ZONE America/Bogota',
           count(*) = 0, count(*),
           min(format('operacion %s', id))
    FROM racha3_operaciones
    WHERE hora_col_inicio       <> EXTRACT(hour FROM inicio_en       AT TIME ZONE 'America/Bogota')::smallint
       OR hora_col_confirmacion <> EXTRACT(hour FROM confirmacion_en AT TIME ZONE 'America/Bogota')::smallint
       OR hora_col_resolucion IS DISTINCT FROM
          (CASE WHEN resuelta_en IS NOT NULL
                THEN EXTRACT(hour FROM resuelta_en AT TIME ZONE 'America/Bogota')::smallint END);

    -- V11: todos los derivados son recomputables y coinciden.
    RETURN QUERY
    WITH gaps AS MATERIALIZED (
        SELECT id FROM (
            SELECT id, jugada_en - lag(jugada_en) OVER (ORDER BY id) AS delta FROM jugadas
        ) g WHERE delta > v_umbral
    ),
    esperado AS (
        SELECT o.*,
               c.inicio_jugada_id AS col_ini,
               c.corte_por_gap,
               lag(o.jugada_confirmacion_id) OVER w AS prev_conf,
               lag(o.confirmacion_en)        OVER w AS prev_conf_en,
               lag(o.jugada_resolucion_id)   OVER w AS prev_resol,
               lag(o.estado)                 OVER w AS prev_estado,
               lag(c.inicio_jugada_id)       OVER w AS prev_col_ini
        FROM racha3_operaciones o
        JOIN columnas c ON c.id = o.columna_id
        WINDOW w AS (ORDER BY o.jugada_confirmacion_id)
    )
    SELECT 'V11', 'derivados (distancias, evaluadas, ties, duracion, bloqueada, integridad) recomputables',
           count(*) = 0, count(*),
           min(format('operacion %s', e.id))
    FROM esperado e
    WHERE e.jugadas_desde_anterior IS DISTINCT FROM (
              CASE WHEN e.prev_conf IS NOT NULL THEN
                  (SELECT count(*)::integer FROM jugadas j
                    WHERE j.id > e.prev_conf AND j.id <= e.jugada_confirmacion_id) END)
       OR e.columnas_desde_anterior IS DISTINCT FROM (
              CASE WHEN e.prev_col_ini IS NOT NULL THEN
                  (SELECT count(*)::integer FROM columnas cc
                    WHERE cc.inicio_jugada_id > e.prev_col_ini
                      AND cc.inicio_jugada_id <= e.col_ini) END)
       -- trunc() explícito, mismo criterio que en la reconstrucción.
       OR e.segundos_desde_anterior IS DISTINCT FROM (
              CASE WHEN e.prev_conf_en IS NOT NULL THEN
                  trunc(EXTRACT(epoch FROM e.confirmacion_en - e.prev_conf_en))::integer END)
       -- Mismo criterio que en la reconstrucción: cota superior concreta,
       -- nunca `OR ... IS NULL`, para que el índice sirva como rango.
       OR e.jugadas_evaluadas IS DISTINCT FROM (
              SELECT count(*)::integer FROM jugadas j
               WHERE j.id > e.jugada_confirmacion_id
                 AND j.id <= COALESCE(e.jugada_resolucion_id, v_max_id))
       OR e.ties_en_operacion IS DISTINCT FROM (
              SELECT count(*)::integer FROM jugadas j
               WHERE j.id > e.jugada_confirmacion_id
                 AND j.id <= COALESCE(e.jugada_resolucion_id, v_max_id)
                 AND j.ganador NOT IN ('PLAYER', 'BANKER'))
       OR e.duracion_ms IS DISTINCT FROM (
              CASE WHEN e.resuelta_en IS NOT NULL
                   THEN (EXTRACT(epoch FROM e.resuelta_en - e.confirmacion_en) * 1000)::bigint END)
       OR e.bloqueada_por_operacion_previa IS DISTINCT FROM (
              e.prev_conf IS NOT NULL
              AND (e.prev_estado = 'PENDIENTE' OR e.jugada_confirmacion_id <= e.prev_resol))
       OR e.integridad_ok IS DISTINCT FROM NOT (
              e.corte_por_gap
              OR EXISTS (SELECT 1 FROM gaps
                          WHERE gaps.id > e.col_ini
                            AND gaps.id <= COALESCE(e.jugada_resolucion_id, v_max_id)));
END;
$$;

COMMENT ON FUNCTION analytics_racha3_validar(integer) IS
    'Invariantes V0..V11 del dominio Racha 3. Sin efectos secundarios. Comprueba lo que un '
    'CHECK no puede: relaciones entre filas, entre tablas y contra los datos reales de jugadas.';

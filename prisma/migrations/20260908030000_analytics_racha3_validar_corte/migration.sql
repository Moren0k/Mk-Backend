-- =====================================================================
-- Corrección de `analytics_racha3_validar()`: acotar la validación al
-- checkpoint.
--
-- PROBLEMA. Las invariantes se evaluaban contra TODAS las filas de
-- `jugadas`, pero las tablas derivadas solo cubren hasta
-- `analytics_checkpoints.ultima_jugada_id`. Con la ingesta corriendo, entre
-- una corrida del incremental y la siguiente siempre hay jugadas nuevas
-- todavía sin procesar, y el validador las reportaba como violación:
--
--   V1  sum(columnas.longitud) = count(jugadas)   -> fallaba por las
--       jugadas posteriores al checkpoint, que aún no tienen columna.
--   V8  la escalera esperada miraba jugadas posteriores al corte, así que
--       una operación PENDIENTE parecía tener niveles que le faltaban.
--   V11 `jugadas_evaluadas` y `ties_en_operacion` se recomputaban contra
--       `max(id)` de toda la tabla, inflando el esperado de las PENDIENTE.
--
-- No se detectó antes porque hasta ahora el validador se ejecutaba siempre
-- inmediatamente después de un rebuild, cuando checkpoint y `max(id)`
-- coinciden. Apareció al correrlo con el scheduler detenido y la ingesta
-- viva.
--
-- CORRECCIÓN. Se calcula `v_corte` una vez, desde el checkpoint (con
-- `max(id)` como respaldo si nunca se procesó), y todas las invariantes se
-- evalúan sobre `jugadas` hasta ese corte. Las conclusiones sobre el rango
-- procesado no cambian: lo que se elimina es el falso negativo por rezago.
--
-- Migración nueva en vez de editar la de F2: esa ya está aplicada.
-- =====================================================================

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
    v_corte bigint;
BEGIN
    -- Corte de validación: las tablas derivadas solo cubren hasta el
    -- checkpoint. Validar contra jugadas posteriores reportaría como fallo
    -- lo que solo es rezago del procesamiento incremental.
    SELECT COALESCE(
        (SELECT ultima_jugada_id FROM analytics_checkpoints WHERE proceso = 'racha3'),
        (SELECT max(id) FROM jugadas)
    ) INTO v_corte;
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
           COALESCE((SELECT sum(longitud) FROM columnas), 0) = (SELECT count(*) FROM jugadas WHERE id <= v_corte),
           abs(COALESCE((SELECT sum(longitud) FROM columnas), 0) - (SELECT count(*) FROM jugadas WHERE id <= v_corte)),
           format('columnas=%s jugadas=%s',
                  COALESCE((SELECT sum(longitud) FROM columnas), 0), (SELECT count(*) FROM jugadas WHERE id <= v_corte));

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
            SELECT id, jugada_en - lag(jugada_en) OVER (ORDER BY id) AS delta FROM jugadas WHERE id <= v_corte
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
                   WHERE j.id > o.jugada_confirmacion_id AND j.id <= v_corte
                     AND j.ganador IN ('PLAYER', 'BANKER')
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
            SELECT id, jugada_en - lag(jugada_en) OVER (ORDER BY id) AS delta FROM jugadas WHERE id <= v_corte
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
                 AND j.id <= COALESCE(e.jugada_resolucion_id, v_corte))
       OR e.ties_en_operacion IS DISTINCT FROM (
              SELECT count(*)::integer FROM jugadas j
               WHERE j.id > e.jugada_confirmacion_id
                 AND j.id <= COALESCE(e.jugada_resolucion_id, v_corte)
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
                            AND gaps.id <= COALESCE(e.jugada_resolucion_id, v_corte)));
END;
$$;
COMMENT ON FUNCTION analytics_racha3_validar(integer) IS
    'Invariantes V0..V11 del dominio Racha 3, evaluadas sobre las jugadas hasta el checkpoint. '
    'Sin efectos secundarios. Comprueba lo que un CHECK no puede: relaciones entre filas, entre '
    'tablas y contra los datos reales de jugadas.';

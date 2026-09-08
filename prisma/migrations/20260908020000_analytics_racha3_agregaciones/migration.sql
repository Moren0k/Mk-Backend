-- =====================================================================
-- F6 - Capa de consulta y agregación de Analytics "Racha 3".
--
-- SOLO LECTURA. Ninguna función de esta migración escribe una fila: son
-- proyecciones sobre lo que F2 dejó en `columnas` y `racha3_operaciones`.
-- No existe `racha3_estadisticas` y no se materializa nada: con ~4.100
-- oportunidades cualquier agregación se resuelve en milisegundos, y una
-- tabla derivada de una tabla derivada solo agregaría un segundo problema
-- de consistencia. El umbral acordado para reconsiderarlo es ~500k filas o
-- p95 > 200 ms en un endpoint real.
--
-- -------------------------------------------------------------------
-- DISCIPLINA DE NOMBRES (obligatoria, no estilística)
--
-- Analytics describe lo que YA ocurrió. No predice. Por eso ninguna
-- columna de esta migración se llama `probabilidad`, `prediccion` ni
-- `confianza`, y los tres conceptos que se confunden con facilidad viajan
-- siempre con nombres distintos:
--
--   frecuencia_historica         proporción de casos observados que
--                                cayeron en una categoría. Suma 1 sobre
--                                todas las categorías.
--   tasa_empirica_condicionada   proporción de veces que ocurrió el evento
--                                ENTRE los casos que llegaron a estar en
--                                riesgo de que ocurriera (hazard empírico).
--                                NO suma 1, y no es comparable con la
--                                anterior.
--   muestra_n                    tamaño de muestra detrás de cada tasa.
--                                Acompaña SIEMPRE a toda proporción: una
--                                tasa sin su n no es información.
--   ventana                      período real que describen los números.
--   advertencia_muestra          texto no nulo cuando `muestra_n` está por
--                                debajo del umbral y la tasa no debe
--                                leerse como estable.
--
-- Interpretar estas métricas como probabilidad predictiva es decisión del
-- Core, y es suya justamente porque requiere supuestos que estos datos no
-- contienen.
--
-- -------------------------------------------------------------------
-- UNIDADES
--
-- TODAS las proporciones son fracciones en [0,1], `numeric(6,4)`, nunca
-- porcentajes. Mezclar fracciones y porcentajes en un mismo conjunto de
-- resultados es una fuente clásica de errores por factor 100; formatear
-- para mostrar es responsabilidad de la capa que presenta (F7). Junto a
-- cada proporción va siempre su conteo crudo, para que el consumidor pueda
-- recomputarla y no tenga que confiar en ella a ciegas.
--
-- -------------------------------------------------------------------
-- FILTROS COMUNES a todas las funciones
--
--   p_desde / p_hasta            ventana sobre `confirmacion_en`
--                                (semiabierta: [desde, hasta)).
--   p_tipo                       'PLAYER' | 'BANKER' | NULL (ambos).
--   p_incluir_bloqueadas         DEFAULT false. Las oportunidades que el
--                                motor real no habría podido operar quedan
--                                FUERA por defecto, porque el consumidor
--                                natural es el Core. Se incluyen a pedido
--                                explícito para análisis histórico completo.
--   p_incluir_integridad_dudosa  DEFAULT true. Criterio distinto y
--                                deliberado: son observaciones reales de lo
--                                que sí quedó registrado, así que excluirlas
--                                por defecto sería descartar datos en
--                                silencio. Se incluyen, pero TODA respuesta
--                                trae `muestra_integridad_dudosa` para que
--                                su presencia nunca pase inadvertida.
--   p_umbral_muestra             DEFAULT 100. Bajo ese n se emite
--                                `advertencia_muestra`.
--
-- Las distancias entre oportunidades se RECALCULAN sobre el subconjunto
-- filtrado; nunca se leen de `racha3_operaciones.jugadas_desde_anterior`,
-- que está calculada sobre TODAS las filas. Usar el valor almacenado tras
-- filtrar daría distancias que no corresponden a la serie consultada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Helpers de bucket.
--
-- Los cortes llegan como `integer[]` en cada llamada, no como una tabla de
-- configuración: cambiar los buckets no debe requerir migración ni
-- redespliegue. `'{5,10,15,20,30,50}'` produce
-- 0-5 / 6-10 / 11-15 / 16-20 / 21-30 / 31-50 / 51+.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_bucket_indice(p_valor numeric, p_cotas integer[])
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT min(i) FROM generate_subscripts(p_cotas, 1) i WHERE p_valor <= p_cotas[i]),
        array_length(p_cotas, 1) + 1
    );
$$;

CREATE OR REPLACE FUNCTION racha3_bucket_etiqueta(p_indice integer, p_cotas integer[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_indice > array_length(p_cotas, 1)
            THEN (p_cotas[array_length(p_cotas, 1)] + 1)::text || '+'
        WHEN p_indice = 1
            THEN '0-' || p_cotas[1]::text
        ELSE (p_cotas[p_indice - 1] + 1)::text || '-' || p_cotas[p_indice]::text
    END;
$$;


-- ---------------------------------------------------------------------
-- vw_racha3 - proyección plana de una oportunidad con su columna.
--
-- Base común de todas las agregaciones y, de paso, la superficie para
-- consultas ad-hoc. No filtra nada: cada función aplica sus propios
-- criterios. `dia_col` va acá y no en la tabla porque `AT TIME ZONE` con
-- nombre de zona es STABLE y no puede materializarse en una columna
-- generada (ver la cabecera de la migración de F1).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_racha3 AS
SELECT
    o.id,
    o.columna_id,
    o.tipo_racha,
    o.apuesta,
    o.estado,
    o.resultado_final,
    o.max_martingalas,
    o.jugada_inicio_id,
    o.jugada_confirmacion_id,
    o.jugada_directa_id,
    o.jugada_mg1_id,
    o.jugada_mg2_id,
    o.jugada_resolucion_id,
    o.inicio_en,
    o.confirmacion_en,
    o.resuelta_en,
    o.duracion_ms,
    o.jugadas_evaluadas,
    o.ties_en_operacion,
    o.hora_col_inicio,
    o.hora_col_confirmacion,
    o.hora_col_resolucion,
    o.bloqueada_por_operacion_previa,
    o.integridad_ok,
    c.longitud       AS columna_longitud,
    c.inicio_jugada_id AS columna_inicio_jugada_id,
    c.corte_por_gap,
    c.cerrada_por_gap,
    -- Día calendario en hora Colombia. Única zona horaria de toda la
    -- analítica temporal; jamás aritmética de offsets.
    (o.confirmacion_en AT TIME ZONE 'America/Bogota')::date AS dia_col
FROM racha3_operaciones o
JOIN columnas c ON c.id = o.columna_id;

COMMENT ON VIEW vw_racha3 IS
    'Proyección plana de racha3_operaciones + su columna. Base de todas las agregaciones de F6 '
    'y superficie para consultas ad-hoc. No aplica ningún filtro.';


-- ---------------------------------------------------------------------
-- racha3_resumen - frecuencia y resultado de operaciones (una fila).
--
-- Cubre "FRECUENCIA" (totales, PLAYER/BANKER y sus proporciones) y
-- "RESULTADO DE OPERACIONES" (DIRECTA/MG1/MG2/LOSS y sus tasas).
--
-- Las tasas se calculan SOLO sobre las oportunidades RESUELTAS: una
-- operación todavía abierta no tiene resultado y meterla en el denominador
-- deprimiría artificialmente todas las tasas. Las PENDIENTE sí cuentan para
-- la frecuencia (ocurrieron) y se reportan aparte.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_resumen(
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_tipo                      text        DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true,
    p_umbral_muestra            integer     DEFAULT 100
)
RETURNS TABLE (
    total                        bigint,
    resueltas                    bigint,
    pendientes                   bigint,
    player                       bigint,
    banker                       bigint,
    frecuencia_historica_player  numeric,
    frecuencia_historica_banker  numeric,
    directa                      bigint,
    mg1                          bigint,
    mg2                          bigint,
    perdidas                     bigint,
    tasa_directa                 numeric,
    tasa_mg1                     numeric,
    tasa_mg2                     numeric,
    tasa_perdida                 numeric,
    tasa_acierto_total           numeric,
    muestra_n                    bigint,
    muestra_bloqueadas_excluidas bigint,
    muestra_integridad_dudosa    bigint,
    ventana_desde                timestamptz,
    ventana_hasta                timestamptz,
    zona_horaria                 text,
    advertencia_muestra          text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH filtrada AS (
        SELECT * FROM vw_racha3
        WHERE (p_desde IS NULL OR confirmacion_en >= p_desde)
          AND (p_hasta IS NULL OR confirmacion_en <  p_hasta)
          AND (p_tipo  IS NULL OR tipo_racha = p_tipo)
          AND (p_incluir_bloqueadas OR NOT bloqueada_por_operacion_previa)
          AND (p_incluir_integridad_dudosa OR integridad_ok)
    ),
    -- Cuántas quedaron fuera por el filtro de bloqueadas: se reporta para
    -- que el consumidor sepa qué NO está viendo, no solo qué ve.
    excluidas AS (
        SELECT count(*) AS n FROM vw_racha3
        WHERE (p_desde IS NULL OR confirmacion_en >= p_desde)
          AND (p_hasta IS NULL OR confirmacion_en <  p_hasta)
          AND (p_tipo  IS NULL OR tipo_racha = p_tipo)
          AND bloqueada_por_operacion_previa
          AND NOT p_incluir_bloqueadas
    ),
    agg AS (
        SELECT
            count(*)                                            AS total,
            count(*) FILTER (WHERE estado = 'RESUELTA')         AS resueltas,
            count(*) FILTER (WHERE estado = 'PENDIENTE')        AS pendientes,
            count(*) FILTER (WHERE tipo_racha = 'PLAYER')       AS player,
            count(*) FILTER (WHERE tipo_racha = 'BANKER')       AS banker,
            count(*) FILTER (WHERE resultado_final = 'DIRECTA') AS directa,
            count(*) FILTER (WHERE resultado_final = 'MG1')     AS mg1,
            count(*) FILTER (WHERE resultado_final = 'MG2')     AS mg2,
            count(*) FILTER (WHERE resultado_final = 'LOSS')    AS perdidas,
            count(*) FILTER (WHERE NOT integridad_ok)           AS integridad_dudosa,
            min(confirmacion_en)                                AS desde,
            max(confirmacion_en)                                AS hasta
        FROM filtrada
    )
    SELECT
        a.total, a.resueltas, a.pendientes, a.player, a.banker,
        round(a.player::numeric / NULLIF(a.total, 0), 4),
        round(a.banker::numeric / NULLIF(a.total, 0), 4),
        a.directa, a.mg1, a.mg2, a.perdidas,
        round(a.directa::numeric  / NULLIF(a.resueltas, 0), 4),
        round(a.mg1::numeric      / NULLIF(a.resueltas, 0), 4),
        round(a.mg2::numeric      / NULLIF(a.resueltas, 0), 4),
        round(a.perdidas::numeric / NULLIF(a.resueltas, 0), 4),
        round((a.directa + a.mg1 + a.mg2)::numeric / NULLIF(a.resueltas, 0), 4),
        a.resueltas,
        e.n,
        a.integridad_dudosa,
        a.desde, a.hasta,
        'America/Bogota',
        CASE WHEN a.resueltas < p_umbral_muestra
             THEN 'muestra_n < ' || p_umbral_muestra::text END
    FROM agg a CROSS JOIN excluidas e;
$$;


-- ---------------------------------------------------------------------
-- racha3_por_hora - análisis temporal en hora Colombia (24 filas).
--
-- Devuelve SIEMPRE las 24 horas, incluso las que no tienen ninguna
-- oportunidad: una hora ausente del resultado se lee como "no hay datos",
-- mientras que una fila con `muestra_n = 0` lo dice explícitamente.
--
-- Cada fila trae su propio `muestra_n` y su `advertencia_muestra`: con
-- ~4.100 oportunidades repartidas en 24 horas, cada hora ronda las 170
-- observaciones, y a ese tamaño una diferencia de varios puntos entre horas
-- es perfectamente compatible con el azar. Una hora NO es mejor por tener
-- mejor tasa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_por_hora(
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_tipo                      text        DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true,
    p_umbral_muestra            integer     DEFAULT 100
)
RETURNS TABLE (
    hora_col                   smallint,
    total                      bigint,
    frecuencia_historica       numeric,
    resueltas                  bigint,
    directa                    bigint,
    mg1                        bigint,
    mg2                        bigint,
    perdidas                   bigint,
    tasa_directa               numeric,
    tasa_mg1                   numeric,
    tasa_mg2                   numeric,
    tasa_perdida               numeric,
    tasa_acierto_total         numeric,
    muestra_n                  bigint,
    muestra_integridad_dudosa  bigint,
    ventana_desde              timestamptz,
    ventana_hasta              timestamptz,
    zona_horaria               text,
    advertencia_muestra        text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH filtrada AS (
        SELECT * FROM vw_racha3
        WHERE (p_desde IS NULL OR confirmacion_en >= p_desde)
          AND (p_hasta IS NULL OR confirmacion_en <  p_hasta)
          AND (p_tipo  IS NULL OR tipo_racha = p_tipo)
          AND (p_incluir_bloqueadas OR NOT bloqueada_por_operacion_previa)
          AND (p_incluir_integridad_dudosa OR integridad_ok)
    ),
    global AS (
        SELECT count(*) AS total, min(confirmacion_en) AS desde, max(confirmacion_en) AS hasta
        FROM filtrada
    ),
    horas AS (SELECT generate_series(0, 23)::smallint AS h)
    SELECT
        horas.h,
        count(f.id),
        round(count(f.id)::numeric / NULLIF(g.total, 0), 4),
        count(f.id) FILTER (WHERE f.estado = 'RESUELTA'),
        count(f.id) FILTER (WHERE f.resultado_final = 'DIRECTA'),
        count(f.id) FILTER (WHERE f.resultado_final = 'MG1'),
        count(f.id) FILTER (WHERE f.resultado_final = 'MG2'),
        count(f.id) FILTER (WHERE f.resultado_final = 'LOSS'),
        round(count(f.id) FILTER (WHERE f.resultado_final = 'DIRECTA')::numeric
              / NULLIF(count(f.id) FILTER (WHERE f.estado = 'RESUELTA'), 0), 4),
        round(count(f.id) FILTER (WHERE f.resultado_final = 'MG1')::numeric
              / NULLIF(count(f.id) FILTER (WHERE f.estado = 'RESUELTA'), 0), 4),
        round(count(f.id) FILTER (WHERE f.resultado_final = 'MG2')::numeric
              / NULLIF(count(f.id) FILTER (WHERE f.estado = 'RESUELTA'), 0), 4),
        round(count(f.id) FILTER (WHERE f.resultado_final = 'LOSS')::numeric
              / NULLIF(count(f.id) FILTER (WHERE f.estado = 'RESUELTA'), 0), 4),
        round(count(f.id) FILTER (WHERE f.resultado_final IN ('DIRECTA','MG1','MG2'))::numeric
              / NULLIF(count(f.id) FILTER (WHERE f.estado = 'RESUELTA'), 0), 4),
        count(f.id) FILTER (WHERE f.estado = 'RESUELTA'),
        count(f.id) FILTER (WHERE NOT f.integridad_ok),
        g.desde, g.hasta,
        'America/Bogota',
        CASE WHEN count(f.id) FILTER (WHERE f.estado = 'RESUELTA') < p_umbral_muestra
             THEN 'muestra_n < ' || p_umbral_muestra::text END
    FROM horas
    CROSS JOIN global g
    LEFT JOIN filtrada f ON f.hora_col_confirmacion = horas.h
    GROUP BY horas.h, g.total, g.desde, g.hasta
    ORDER BY horas.h;
$$;


-- ---------------------------------------------------------------------
-- racha3_por_dia - frecuencia temporal, por día calendario en Bogotá.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_por_dia(
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_tipo                      text        DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true,
    p_umbral_muestra            integer     DEFAULT 100
)
RETURNS TABLE (
    dia_col                   date,
    total                     bigint,
    resueltas                 bigint,
    directa                   bigint,
    mg1                       bigint,
    mg2                       bigint,
    perdidas                  bigint,
    tasa_acierto_total        numeric,
    tasa_perdida              numeric,
    muestra_n                 bigint,
    muestra_integridad_dudosa bigint,
    zona_horaria              text,
    advertencia_muestra       text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        dia_col,
        count(*),
        count(*) FILTER (WHERE estado = 'RESUELTA'),
        count(*) FILTER (WHERE resultado_final = 'DIRECTA'),
        count(*) FILTER (WHERE resultado_final = 'MG1'),
        count(*) FILTER (WHERE resultado_final = 'MG2'),
        count(*) FILTER (WHERE resultado_final = 'LOSS'),
        round(count(*) FILTER (WHERE resultado_final IN ('DIRECTA','MG1','MG2'))::numeric
              / NULLIF(count(*) FILTER (WHERE estado = 'RESUELTA'), 0), 4),
        round(count(*) FILTER (WHERE resultado_final = 'LOSS')::numeric
              / NULLIF(count(*) FILTER (WHERE estado = 'RESUELTA'), 0), 4),
        count(*) FILTER (WHERE estado = 'RESUELTA'),
        count(*) FILTER (WHERE NOT integridad_ok),
        'America/Bogota',
        CASE WHEN count(*) FILTER (WHERE estado = 'RESUELTA') < p_umbral_muestra
             THEN 'muestra_n < ' || p_umbral_muestra::text END
    FROM vw_racha3
    WHERE (p_desde IS NULL OR confirmacion_en >= p_desde)
      AND (p_hasta IS NULL OR confirmacion_en <  p_hasta)
      AND (p_tipo  IS NULL OR tipo_racha = p_tipo)
      AND (p_incluir_bloqueadas OR NOT bloqueada_por_operacion_previa)
      AND (p_incluir_integridad_dudosa OR integridad_ok)
    GROUP BY dia_col
    ORDER BY dia_col;
$$;


-- ---------------------------------------------------------------------
-- racha3_serie_distancias - núcleo compartido de intervalos y hazard.
--
-- Devuelve, para el subconjunto filtrado y EN ORDEN, la distancia de cada
-- oportunidad respecto de la anterior, medida en tres unidades. Se
-- recalcula sobre el subconjunto en vez de leer
-- `racha3_operaciones.jugadas_desde_anterior`, que está calculado sobre
-- TODAS las filas: tras excluir las bloqueadas, aquel valor describiría una
-- serie distinta de la consultada.
--
-- `p_entre`:
--   'RACHA3'    distancia entre oportunidades consecutivas.
--   'PERDIDAS'  distancia entre pérdidas consecutivas (solo LOSS).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_serie_distancias(
    p_entre                     text        DEFAULT 'RACHA3',
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_tipo                      text        DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true
)
RETURNS TABLE (
    jugada_confirmacion_id bigint,
    confirmacion_en        timestamptz,
    jugadas                integer,
    columnas               integer,
    segundos               integer
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH filtrada AS (
        SELECT jugada_confirmacion_id, confirmacion_en, columna_inicio_jugada_id
        FROM vw_racha3
        WHERE (p_desde IS NULL OR confirmacion_en >= p_desde)
          AND (p_hasta IS NULL OR confirmacion_en <  p_hasta)
          AND (p_tipo  IS NULL OR tipo_racha = p_tipo)
          AND (p_incluir_bloqueadas OR NOT bloqueada_por_operacion_previa)
          AND (p_incluir_integridad_dudosa OR integridad_ok)
          AND (p_entre <> 'PERDIDAS' OR resultado_final = 'LOSS')
    ),
    ord AS (
        SELECT
            jugada_confirmacion_id,
            confirmacion_en,
            columna_inicio_jugada_id,
            lag(jugada_confirmacion_id)   OVER w AS prev_id,
            lag(confirmacion_en)          OVER w AS prev_en,
            lag(columna_inicio_jugada_id) OVER w AS prev_col
        FROM filtrada
        WINDOW w AS (ORDER BY jugada_confirmacion_id)
    )
    -- Las distancias se cuentan con subconsultas correlacionadas, y es la
    -- forma MEDIDA como más rápida, no la más obvia.
    --
    -- Se probó la alternativa "elegante": numerar todas las jugadas y
    -- columnas con `row_number()` una sola vez y restar ordinales. Lee menos
    -- de la mitad de buffers (12.689 contra 29.302) y aun así resulta
    -- consistentemente MÁS LENTA (`racha3_distribucion` 163 ms contra 126 ms;
    -- `racha3_intervalos` 101 ms contra 63 ms), porque ordenar 42k jugadas y
    -- 25k columnas y armar los hashes cuesta más que 4.100 recorridos de
    -- rango sobre un índice que ya está entero en caché (`Shared Read
    -- Blocks = 0`).
    --
    -- Si algún día `jugadas` deja de entrar en memoria, la comparación puede
    -- invertirse: hay que volver a medir antes de cambiarla, no razonarlo.
    SELECT
        jugada_confirmacion_id,
        confirmacion_en,
        (SELECT count(*)::integer FROM jugadas j
          WHERE j.id > prev_id AND j.id <= jugada_confirmacion_id),
        (SELECT count(*)::integer FROM columnas c
          WHERE c.inicio_jugada_id > prev_col AND c.inicio_jugada_id <= columna_inicio_jugada_id),
        -- Truncado, no redondeado: misma semántica de "segundos completos"
        -- fijada en F2 (`::integer` a secas redondea en PostgreSQL).
        trunc(EXTRACT(epoch FROM confirmacion_en - prev_en))::integer
    FROM ord
    WHERE prev_id IS NOT NULL;
$$;


-- ---------------------------------------------------------------------
-- racha3_intervalos - estadísticos de los intervalos (3 filas).
--
-- Una fila por unidad de medida: jugadas, columnas y segundos. Se devuelven
-- las tres juntas a propósito: mirar solo una induce a conclusiones que la
-- otra desmiente (p. ej. un intervalo corto en jugadas puede ser largo en
-- tiempo si hubo un hueco en el historial).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_intervalos(
    p_entre                     text        DEFAULT 'RACHA3',
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_tipo                      text        DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true,
    p_umbral_muestra            integer     DEFAULT 100
)
RETURNS TABLE (
    metrica             text,
    muestra_n           bigint,
    minimo              integer,
    p25                 numeric,
    mediana             numeric,
    p75                 numeric,
    p90                 numeric,
    p99                 numeric,
    maximo              integer,
    promedio            numeric,
    desviacion          numeric,
    advertencia_muestra text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH s AS (
        SELECT * FROM racha3_serie_distancias(
            p_entre, p_desde, p_hasta, p_tipo,
            p_incluir_bloqueadas, p_incluir_integridad_dudosa)
    ),
    largo AS (
        SELECT 'jugadas'  AS metrica, jugadas  AS v FROM s
        UNION ALL SELECT 'columnas', columnas FROM s
        UNION ALL SELECT 'segundos', segundos FROM s
    )
    SELECT
        metrica,
        count(*),
        min(v),
        round(percentile_cont(0.25) WITHIN GROUP (ORDER BY v)::numeric, 2),
        round(percentile_cont(0.50) WITHIN GROUP (ORDER BY v)::numeric, 2),
        round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2),
        round(percentile_cont(0.90) WITHIN GROUP (ORDER BY v)::numeric, 2),
        round(percentile_cont(0.99) WITHIN GROUP (ORDER BY v)::numeric, 2),
        max(v),
        round(avg(v)::numeric, 2),
        round(stddev_samp(v)::numeric, 2),
        CASE WHEN count(*) < p_umbral_muestra
             THEN 'muestra_n < ' || p_umbral_muestra::text END
    FROM largo
    GROUP BY metrica
    ORDER BY metrica;
$$;


-- ---------------------------------------------------------------------
-- racha3_distribucion - distribución por buckets (frecuencia histórica).
--
-- Esto es FRECUENCIA DE OCURRENCIA: de todos los intervalos observados,
-- qué proporción midió tanto. Suma 1 sobre todos los buckets. NO responde
-- "qué tan probable es que ocurra ahora" — para eso está
-- `racha3_hazard_distancia`, que es una magnitud distinta y no comparable.
--
-- Devuelve TODOS los buckets, incluso los vacíos: un bucket ausente se
-- confunde con "no consultado", uno con `n = 0` dice lo que realmente pasa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_distribucion(
    p_metrica                   text        DEFAULT 'jugadas',
    p_cotas                     integer[]   DEFAULT '{5,10,15,20,30,50}',
    p_entre                     text        DEFAULT 'RACHA3',
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_tipo                      text        DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true
)
RETURNS TABLE (
    bucket               text,
    orden                integer,
    n                    bigint,
    frecuencia_historica numeric,
    muestra_n            bigint,
    metrica              text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH s AS (
        SELECT * FROM racha3_serie_distancias(
            p_entre, p_desde, p_hasta, p_tipo,
            p_incluir_bloqueadas, p_incluir_integridad_dudosa)
    ),
    v AS (
        SELECT CASE p_metrica
                   WHEN 'jugadas'  THEN jugadas
                   WHEN 'columnas' THEN columnas
                   WHEN 'segundos' THEN segundos
               END AS valor
        FROM s
    ),
    total AS (SELECT count(*) AS n FROM v),
    buckets AS (
        SELECT i AS orden, racha3_bucket_etiqueta(i, p_cotas) AS etiqueta
        FROM generate_series(1, array_length(p_cotas, 1) + 1) i
    ),
    conteo AS (
        SELECT racha3_bucket_indice(valor, p_cotas) AS orden, count(*) AS n
        FROM v GROUP BY 1
    )
    SELECT
        b.etiqueta,
        b.orden,
        COALESCE(c.n, 0),
        round(COALESCE(c.n, 0)::numeric / NULLIF(t.n, 0), 4),
        t.n,
        p_metrica
    FROM buckets b
    CROSS JOIN total t
    LEFT JOIN conteo c ON c.orden = b.orden
    ORDER BY b.orden;
$$;


-- ---------------------------------------------------------------------
-- racha3_hazard_distancia - tasa empírica condicionada por distancia.
--
-- Responde: "de todas las veces que el historial llegó a estar a distancia
-- d de la última Racha 3 sin que apareciera otra, ¿en qué proporción
-- apareció justo ahí?".
--
-- Definición explícita, porque es donde se cometen los errores:
--
--   casos_observados(d)  jugadas del historial que ESTUVIERON a distancia d
--                        de la confirmación anterior. Es el conjunto en
--                        riesgo. Un intervalo de largo k aporta un caso a
--                        cada d de 1..k; la cola posterior a la última
--                        confirmación también aporta, sin evento.
--   eventos(d)           de esos casos, en cuántos la jugada fue ella misma
--                        una confirmación.
--   tasa_empirica_condicionada = eventos / casos_observados
--
-- Esto NO es lo mismo que `frecuencia_historica`, que también viene en el
-- resultado justamente para poder contrastarlas: la frecuencia es la
-- proporción de intervalos cuyo largo cayó en el bucket (suma 1 entre todos
-- los buckets), la tasa condicionada no suma 1 y crece naturalmente en los
-- buckets lejanos porque su denominador se achica.
--
-- Ninguna de las dos es una probabilidad predictiva. Convertirlas en una
-- exige supuestos (independencia, estacionariedad) que estos datos no
-- contienen y que decide el Core.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_hazard_distancia(
    p_cotas                     integer[]   DEFAULT '{5,10,15,20,30,50}',
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_tipo                      text        DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true,
    p_umbral_muestra            integer     DEFAULT 100
)
RETURNS TABLE (
    bucket                     text,
    orden                      integer,
    casos_observados           bigint,
    eventos                    bigint,
    tasa_empirica_condicionada numeric,
    intervalos_en_bucket       bigint,
    frecuencia_historica       numeric,
    muestra_n                  bigint,
    advertencia_muestra        text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH s AS (
        SELECT jugadas AS k FROM racha3_serie_distancias(
            'RACHA3', p_desde, p_hasta, p_tipo,
            p_incluir_bloqueadas, p_incluir_integridad_dudosa)
    ),
    total AS (SELECT count(*) AS n FROM s),
    -- La cola: jugadas transcurridas desde la última confirmación sin que
    -- haya aparecido otra. Está en riesgo pero no produjo evento; omitirla
    -- sesgaría la tasa hacia arriba.
    cola AS (
        SELECT COALESCE(
            (SELECT count(*) FROM jugadas j
              WHERE j.id > (SELECT max(jugada_confirmacion_id) FROM racha3_operaciones)),
            0)::integer AS m
    ),
    max_d AS (
        SELECT GREATEST(COALESCE((SELECT max(k) FROM s), 0), (SELECT m FROM cola)) AS d
    ),
    riesgo AS (
        SELECT
            d,
            (SELECT count(*) FROM s WHERE s.k >= d)
                + (CASE WHEN (SELECT m FROM cola) >= d THEN 1 ELSE 0 END) AS casos,
            (SELECT count(*) FROM s WHERE s.k = d)                        AS eventos
        FROM generate_series(1, GREATEST((SELECT d FROM max_d), 1)) d
    ),
    buckets AS (
        SELECT i AS orden, racha3_bucket_etiqueta(i, p_cotas) AS etiqueta
        FROM generate_series(1, array_length(p_cotas, 1) + 1) i
    ),
    agrupado AS (
        SELECT racha3_bucket_indice(d, p_cotas) AS orden,
               sum(casos)   AS casos,
               sum(eventos) AS eventos
        FROM riesgo GROUP BY 1
    )
    SELECT
        b.etiqueta,
        b.orden,
        COALESCE(a.casos, 0),
        COALESCE(a.eventos, 0),
        round(COALESCE(a.eventos, 0)::numeric / NULLIF(a.casos, 0), 4),
        COALESCE(a.eventos, 0),
        round(COALESCE(a.eventos, 0)::numeric / NULLIF(t.n, 0), 4),
        t.n,
        CASE WHEN COALESCE(a.casos, 0) < p_umbral_muestra
             THEN 'casos_observados < ' || p_umbral_muestra::text END
    FROM buckets b
    CROSS JOIN total t
    LEFT JOIN agrupado a ON a.orden = b.orden
    ORDER BY b.orden;
$$;


-- ---------------------------------------------------------------------
-- racha3_columnas_distribucion - longitudes de columna por tipo.
--
-- Base para el futuro concepto "L" (columna PLAYER/BANKER de longitud >= 6)
-- sin volver a interpretar `jugadas`. `truncadas` cuenta las columnas cuya
-- longitud observada pudo quedar cortada por un hueco del historial: en un
-- análisis de longitudes es exactamente el dato que no debe pasarse por
-- alto, porque sesga hacia longitudes menores.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_columnas_distribucion(
    p_tipo   text    DEFAULT NULL,
    p_maximo integer DEFAULT 10
)
RETURNS TABLE (
    tipo                 text,
    longitud             text,
    orden                integer,
    n                    bigint,
    frecuencia_historica numeric,
    truncadas            bigint,
    muestra_n            bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH filtrada AS (
        SELECT c.tipo, c.longitud, (c.corte_por_gap OR c.cerrada_por_gap) AS truncada
        FROM columnas c
        WHERE c.tipo IN ('PLAYER', 'BANKER')
          AND (p_tipo IS NULL OR c.tipo = p_tipo)
    ),
    total AS (SELECT tipo, count(*) AS n FROM filtrada GROUP BY tipo)
    SELECT
        f.tipo,
        CASE WHEN f.longitud >= p_maximo THEN p_maximo::text || '+' ELSE f.longitud::text END,
        LEAST(f.longitud, p_maximo),
        count(*),
        round(count(*)::numeric / NULLIF(t.n, 0), 4),
        count(*) FILTER (WHERE f.truncada),
        t.n
    FROM filtrada f
    JOIN total t ON t.tipo = f.tipo
    GROUP BY f.tipo, 2, 3, t.n
    ORDER BY f.tipo, 3;
$$;

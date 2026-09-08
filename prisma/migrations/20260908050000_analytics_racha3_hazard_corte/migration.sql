-- =====================================================================
-- Corrección de `racha3_hazard_distancia()`: acotar la cola al checkpoint.
--
-- PROBLEMA. La cola —jugadas transcurridas desde la última confirmación sin
-- que apareciera otra Racha 3— se contaba contra `jugadas` SIN cota:
--
--     cola AS (
--         SELECT count(*) FROM jugadas j
--          WHERE j.id > (SELECT max(jugada_confirmacion_id)
--                          FROM racha3_operaciones))
--
-- `jugadas` está vivo; `racha3_operaciones` solo llega hasta
-- `analytics_checkpoints.ultima_jugada_id`. Todo lo que la ingesta insertó
-- después del último incremental entraba en la cola como si fuera tiempo en
-- riesgo ya observado, cuando en realidad Analytics todavía no lo procesó y
-- no sabe si contiene confirmaciones.
--
-- El daño no es un desvío pequeño, porque la cola entra en dos lugares:
--
--     max_d  = GREATEST(max(k), m)
--     casos(d) = #{k >= d} + (CASE WHEN m >= d THEN 1 ELSE 0 END)
--
-- es decir, la cola aporta +1 a CADA distancia de 1..m y además estira el
-- rango de distancias hasta m. Con la ingesta viva y el scheduler detenido
-- (m = 1.371 sobre un `max(k)` real de 74) el último bucket acumulaba las
-- 1.321 distancias 51..1.371 que ningún intervalo observado alcanzó nunca:
--
--     casos_observados('51+') = 1.385
--        ·   64 reales (d = 51..74)
--        · 1.321 ficticios, aportados por la cola sin cota
--
-- Consecuencias medidas:
--   · `tasa_empirica_condicionada` del bucket lejano hundida por un
--     denominador inflado ~19x (0,0058 contra su valor real).
--   · Rota la única propiedad estructural del conjunto en riesgo: sobre la
--     serie real `riesgo(51) = 8` y decrece monótonamente hasta
--     `riesgo(74) = 1`, así que la suma de d >= 51 no puede pasar de 192.
--     Se reportaban 1.385.
--
-- No se detectó en F6 porque el scheduler corría cada 60 s: con el
-- incremental al día la cola vale 1-2 jugadas y el sesgo es invisible.
-- Apareció al correr `analytics:verify` con la aplicación detenida.
--
-- Es el MISMO error de horizonte que corrigió
-- `20260908030000_analytics_racha3_validar_corte` para el validador: las
-- tablas derivadas llegan hasta el checkpoint y cualquier lectura de
-- `jugadas` que se compare con ellas debe acotarse al mismo corte.
--
-- CORRECCIÓN. Se añade el CTE `corte`, con el mismo horizonte y el mismo
-- respaldo que usa el validador (`max(id)` si nunca se procesó nada), y la
-- cola se cuenta solo hasta ahí. Nada más cambia: la definición del hazard,
-- el conjunto en riesgo, los eventos, los buckets y la aritmética quedan
-- idénticos. `jugadas` sigue siendo la fuente de verdad — lo que cambia es
-- hasta dónde se la lee, no de dónde se lee.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA, a propósito. La cola se ancla a
-- `max(jugada_confirmacion_id)` de TODA la tabla, sin aplicar `p_tipo`,
-- `p_desde`, `p_hasta` ni los filtros de bloqueadas/integridad que sí
-- aplican a la serie `s`. Con los valores por defecto eso es correcto (la
-- cola es la del historial completo, que es de lo que habla el hazard sin
-- filtrar), pero al pasar una ventana temporal la cola sigue siendo la del
-- presente y no la del final de esa ventana. Es un defecto distinto y
-- arreglarlo cambiaría la semántica del hazard bajo filtros, así que queda
-- registrado como limitación conocida en ANALYTICS.md §11 y no se altera
-- aquí.
--
-- Migración nueva en vez de editar la de F6: esa ya está aplicada.
-- =====================================================================

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
    -- Horizonte del dominio derivado. Idéntico al de
    -- `analytics_racha3_validar()`: hasta donde llegó el incremental, con
    -- `max(id)` como respaldo si nunca se procesó nada.
    corte AS (
        SELECT COALESCE(
            (SELECT ultima_jugada_id FROM analytics_checkpoints WHERE proceso = 'racha3'),
            (SELECT max(id) FROM jugadas)
        ) AS id
    ),
    -- La cola: jugadas transcurridas desde la última confirmación sin que
    -- haya aparecido otra. Está en riesgo pero no produjo evento; omitirla
    -- sesgaría la tasa hacia arriba. Se cuenta solo hasta el corte: una
    -- jugada que Analytics todavía no procesó no es tiempo en riesgo
    -- observado, porque nadie comprobó aún si es ella misma una
    -- confirmación.
    cola AS (
        SELECT COALESCE(
            (SELECT count(*) FROM jugadas j
              WHERE j.id > (SELECT max(jugada_confirmacion_id) FROM racha3_operaciones)
                AND j.id <= (SELECT id FROM corte)),
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

COMMENT ON FUNCTION racha3_hazard_distancia(integer[], timestamptz, timestamptz, text, boolean, boolean, integer) IS
    'Tasa empírica condicionada por distancia (hazard). La cola en riesgo se '
    'acota al checkpoint de Analytics: las jugadas posteriores no son tiempo '
    'en riesgo observado. Descriptivo, nunca predictivo. Ver ANALYTICS.md.';

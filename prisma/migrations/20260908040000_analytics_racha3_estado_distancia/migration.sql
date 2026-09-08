-- =====================================================================
-- F7 - Las dos consultas de estado que la API necesita y F6 no cubría.
--
-- Van en SQL, no en un servicio de TypeScript, por la misma razón que todo
-- lo anterior: la capa de consulta del dominio vive en un solo lugar y se
-- verifica en un solo lugar. Un `count(*)` escrito en un controller sería
-- lógica de dominio fuera del alcance de `pnpm analytics:verify`.
--
-- Ambas son de SOLO LECTURA.
-- =====================================================================


-- ---------------------------------------------------------------------
-- racha3_distancia_actual - cuántas jugadas van desde la última Racha 3.
--
-- Responde la pregunta operativa, y de paso expone su propio margen de
-- error. Hay dos números distintos y ambos importan:
--
--   jugadas_desde_ultima   se cuenta sobre las jugadas REALES, incluidas
--                          las que el incremental todavía no procesó. Es
--                          el número operativamente útil.
--   jugadas_sin_procesar   cuánto rezago hay respecto del checkpoint. Si
--                          es 0, `jugadas_desde_ultima` es exacto. Si no,
--                          podría existir una Racha 3 ya ocurrida y aún no
--                          detectada dentro de ese rezago, y entonces la
--                          distancia real sería MENOR que la informada.
--
-- Ocultar el segundo número convertiría una estimación en una afirmación.
--
-- `p_incluir_bloqueadas` existe y debe usarse con el MISMO valor que en
-- `racha3_hazard_distancia()`: la distancia sólo es comparable contra los
-- buckets si se mide sobre la misma serie con la que se construyeron. Con
-- criterios distintos, el número y su bucket describirían dos cosas
-- diferentes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_distancia_actual(
    p_incluir_bloqueadas boolean DEFAULT false
)
RETURNS TABLE (
    jugadas_desde_ultima          integer,
    jugadas_sin_procesar          bigint,
    distancia_exacta              boolean,
    ultima_jugada_confirmacion_id bigint,
    ultima_confirmacion_en        timestamptz,
    ultima_hora_col               smallint,
    ultima_tipo_racha             text,
    ultima_estado                 text,
    ultima_resultado_final        text,
    jugada_mas_reciente_id        bigint,
    jugada_mas_reciente_en        timestamptz,
    zona_horaria                  text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH ultima AS (
        SELECT jugada_confirmacion_id, confirmacion_en, hora_col_confirmacion,
               tipo_racha, estado, resultado_final
        FROM vw_racha3
        WHERE (p_incluir_bloqueadas OR NOT bloqueada_por_operacion_previa)
        ORDER BY jugada_confirmacion_id DESC
        LIMIT 1
    ),
    reciente AS (SELECT id, jugada_en FROM jugadas ORDER BY id DESC LIMIT 1),
    corte AS (
        SELECT COALESCE(
            (SELECT ultima_jugada_id FROM analytics_checkpoints WHERE proceso = 'racha3'),
            (SELECT id FROM reciente)
        ) AS id
    )
    SELECT
        (SELECT count(*)::integer FROM jugadas j
          WHERE j.id > (SELECT jugada_confirmacion_id FROM ultima)),
        (SELECT count(*) FROM jugadas j WHERE j.id > (SELECT id FROM corte)),
        (SELECT count(*) FROM jugadas j WHERE j.id > (SELECT id FROM corte)) = 0,
        u.jugada_confirmacion_id,
        u.confirmacion_en,
        u.hora_col_confirmacion,
        u.tipo_racha,
        u.estado,
        u.resultado_final,
        r.id,
        r.jugada_en,
        'America/Bogota'
    FROM ultima u CROSS JOIN reciente r;
$$;


-- ---------------------------------------------------------------------
-- racha3_estado - salud del pipeline derivado.
--
-- Una fila con hasta dónde procesó, cuánto falta y cómo terminó la última
-- corrida. Es lo que permite distinguir "no hay Racha 3 nuevas" de "el
-- procesamiento está caído": sin esto, ambas cosas se ven igual desde
-- afuera.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_estado()
RETURNS TABLE (
    checkpoint_existe            boolean,
    ultima_jugada_procesada      bigint,
    ultima_jugada_procesada_en   timestamptz,
    reproceso_desde_jugada_id    bigint,
    checkpoint_actualizado_en    timestamptz,
    jugadas_sin_procesar         bigint,
    jugada_mas_reciente_id       bigint,
    jugada_mas_reciente_en       timestamptz,
    total_jugadas                bigint,
    total_columnas               bigint,
    total_oportunidades          bigint,
    oportunidades_pendientes     bigint,
    ejecucion_id                 bigint,
    ejecucion_tipo               text,
    ejecucion_estado             text,
    ejecucion_error              text,
    ejecucion_duracion_ms        integer,
    ejecucion_en                 timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH cp AS (
        SELECT * FROM analytics_checkpoints WHERE proceso = 'racha3'
    ),
    reciente AS (SELECT id, jugada_en FROM jugadas ORDER BY id DESC LIMIT 1),
    ej AS (
        SELECT * FROM analytics_ejecuciones
        WHERE proceso = 'racha3'
        ORDER BY iniciado_en DESC
        LIMIT 1
    )
    SELECT
        (SELECT count(*) FROM cp) > 0,
        (SELECT ultima_jugada_id FROM cp),
        (SELECT ultima_jugada_en FROM cp),
        (SELECT reproceso_desde_jugada_id FROM cp),
        (SELECT actualizado_en FROM cp),
        -- Sin checkpoint todavía, todo el historial está sin procesar.
        (SELECT count(*) FROM jugadas j
          WHERE j.id > COALESCE((SELECT ultima_jugada_id FROM cp), 0)),
        (SELECT id FROM reciente),
        (SELECT jugada_en FROM reciente),
        (SELECT count(*) FROM jugadas),
        (SELECT count(*) FROM columnas),
        (SELECT count(*) FROM racha3_operaciones),
        (SELECT count(*) FROM racha3_operaciones WHERE estado = 'PENDIENTE'),
        (SELECT id FROM ej),
        (SELECT tipo FROM ej),
        (SELECT estado FROM ej),
        (SELECT error FROM ej),
        (SELECT duracion_ms FROM ej),
        (SELECT COALESCE(terminado_en, iniciado_en) FROM ej);
$$;

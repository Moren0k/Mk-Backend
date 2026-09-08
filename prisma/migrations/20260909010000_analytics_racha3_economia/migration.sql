-- =====================================================================
-- Capa de ECONOMÍA de la Racha 3: los dos insumos que faltaban para poder
-- decidir si una apuesta tiene expectativa positiva.
--
-- POR QUÉ HACEN FALTA
--
-- Hasta ahora el dominio sabía responder "¿con qué frecuencia acierta esta
-- condición?", y con eso se construyó un umbral relativo: comparar el
-- límite inferior de un subgrupo contra el del histórico completo. Ese
-- umbral es incoherente — el subgrupo es parte del grupo — y con sólo dos
-- categorías (PLAYER, BANKER) degenera en una tautología: una está siempre
-- por encima del promedio y la otra siempre por debajo, así que el filtro
-- no filtra.
--
-- El umbral que sí significa algo es el PUNTO DE EQUILIBRIO de la apuesta:
-- la tasa de acierto por debajo de la cual la operación pierde dinero. Sale
-- de la estructura de pago, no del historial de aciertos:
--
--     gana  -> +1 unidad (en cualquier gale)
--     falla -> -(1+2+4) = -7 unidades
--     TIE   -> devuelve el 90 %, es decir cuesta el 10 % de lo apostado
--              en ese nivel; no consume gale y no cierra la operación
--
--     EV = p·1 - (1-p)·7 - peaje_tie = 0   =>   p = (7 + peaje_tie) / 8
--
-- Medido sobre el histórico, `peaje_tie` = 0,0386 unidades por operación, y
-- eso mueve el equilibrio de 87,500 % a 87,983 %. No es un detalle: la tasa
-- global observada es 87,980 %, tres milésimas POR DEBAJO del equilibrio, y
-- las unidades netas reales del histórico completo son -0,9 en vez de las
-- +162 que se reportan hoy ignorando el peaje.
--
-- Ninguna de estas dos funciones predice nada. Siguen siendo descriptivas:
-- una cuenta caras del dado, la otra cuenta TIEs. La aritmética de decisión
-- vive en el Core, igual que siempre.
--
-- ---------------------------------------------------------------------
-- racha3_lados_jugadas - distribución de ganadores sobre `jugadas`.
--
-- Sirve para estimar la ventaja del lado que se va a apostar con MUCHO más
-- dato que a nivel de oportunidad: ~39.000 jugadas no-TIE contra ~4.200
-- oportunidades resueltas. Nueve veces más muestra sobre la misma pregunta.
--
-- Acotada al checkpoint como todo el dominio derivado. No hace falta para
-- la corrección de esta función en particular (es un estadístico de
-- `jugadas` y no se compara contra las tablas derivadas), pero mezclar
-- horizontes dentro del mismo dominio es la clase de error que ya costó una
-- migración correctiva (`20260908050000`). Las ~1.300 jugadas que quedan
-- fuera no mueven una estimación de 39.000.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_lados_jugadas(
    p_desde timestamptz DEFAULT NULL,
    p_hasta timestamptz DEFAULT NULL
)
RETURNS TABLE (
    total     bigint,
    banker    bigint,
    player    bigint,
    tie       bigint,
    no_tie    bigint,
    corte_id  bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH corte AS (
        SELECT COALESCE(
            (SELECT ultima_jugada_id FROM analytics_checkpoints WHERE proceso = 'racha3'),
            (SELECT max(id) FROM jugadas)
        ) AS id
    ),
    j AS (
        SELECT ganador
          FROM jugadas
         WHERE id <= (SELECT id FROM corte)
           AND (p_desde IS NULL OR jugada_en >= p_desde)
           AND (p_hasta IS NULL OR jugada_en <= p_hasta)
    )
    SELECT count(*),
           count(*) FILTER (WHERE ganador = 'BANKER'),
           count(*) FILTER (WHERE ganador = 'PLAYER'),
           count(*) FILTER (WHERE ganador = 'TIE'),
           count(*) FILTER (WHERE ganador IN ('BANKER', 'PLAYER')),
           (SELECT id FROM corte)
      FROM j;
$$;


-- ---------------------------------------------------------------------
-- racha3_ties_por_nivel - TIEs ocurridos DENTRO de operaciones, por nivel
-- de la escalera.
--
-- Un TIE del nivel 0 es el que cae entre la confirmación y la primera
-- apuesta resuelta; el del nivel 1 entre la directa y la mg1; el del nivel
-- 2 entre la mg1 y la mg2. Importa separarlos porque la apuesta se duplica
-- en cada nivel, así que un TIE del nivel 2 cuesta cuatro veces lo que uno
-- del nivel 0.
--
-- Se devuelven CONTEOS, no unidades: cuánto cuesta un TIE depende de la
-- escalera y del porcentaje de devolución, y ésos son parámetros de
-- política que viven en la configuración del Core, no en SQL. Así, cambiar
-- la devolución de 90 % a 100 % no exige una migración.
--
-- Sobre el histórico actual (todas las apuestas):
--     nivel 0: 561 TIEs · nivel 1: 280 · nivel 2: 127
-- Cada nivel cuesta casi lo mismo (56,10 / 56,00 / 50,80 unidades): hay la
-- mitad de TIEs en cada nivel siguiente, pero la apuesta es el doble. Por
-- eso el peaje NO se diluye al añadir gales.
--
-- Control de consistencia: la suma de los tres niveles reproduce
-- `ties_en_operacion` en las 4.218 operaciones, sin un solo descuadre. La
-- invariante está en `analytics:verify`.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racha3_ties_por_nivel(
    p_apuesta                   text        DEFAULT NULL,
    p_desde                     timestamptz DEFAULT NULL,
    p_hasta                     timestamptz DEFAULT NULL,
    p_incluir_bloqueadas        boolean     DEFAULT false,
    p_incluir_integridad_dudosa boolean     DEFAULT true
)
RETURNS TABLE (
    nivel        integer,
    ties         bigint,
    operaciones  bigint,
    alcanzaron   bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    WITH o AS (
        SELECT *
          FROM racha3_operaciones
         WHERE estado = 'RESUELTA'
           AND (p_apuesta IS NULL OR apuesta = p_apuesta)
           AND (p_desde   IS NULL OR confirmacion_en >= p_desde)
           AND (p_hasta   IS NULL OR confirmacion_en <= p_hasta)
           AND (p_incluir_bloqueadas OR NOT bloqueada_por_operacion_previa)
           AND (p_incluir_integridad_dudosa OR integridad_ok)
    ),
    -- Sin COALESCE a "infinito" en la cota superior: si el nivel no se
    -- alcanzó, no tiene TIEs propios. Ese COALESCE fue exactamente el bug
    -- que infló el hazard (ver `20260908050000`), y acá habría contado los
    -- TIE de toda la tabla.
    n0 AS (
        SELECT count(*) AS ties
          FROM o JOIN jugadas j
            ON j.ganador = 'TIE'
           AND j.id > o.jugada_confirmacion_id
           AND j.id < o.jugada_directa_id
    ),
    n1 AS (
        SELECT count(*) AS ties
          FROM o JOIN jugadas j
            ON j.ganador = 'TIE'
           AND o.jugada_mg1_id IS NOT NULL
           AND j.id > o.jugada_directa_id
           AND j.id < o.jugada_mg1_id
    ),
    n2 AS (
        SELECT count(*) AS ties
          FROM o JOIN jugadas j
            ON j.ganador = 'TIE'
           AND o.jugada_mg2_id IS NOT NULL
           AND j.id > o.jugada_mg1_id
           AND j.id < o.jugada_mg2_id
    ),
    tot AS (
        SELECT count(*)                                          AS operaciones,
               count(*) FILTER (WHERE jugada_directa_id IS NOT NULL) AS a0,
               count(*) FILTER (WHERE jugada_mg1_id     IS NOT NULL) AS a1,
               count(*) FILTER (WHERE jugada_mg2_id     IS NOT NULL) AS a2
          FROM o
    )
    SELECT 0, (SELECT ties FROM n0), t.operaciones, t.a0 FROM tot t
    UNION ALL
    SELECT 1, (SELECT ties FROM n1), t.operaciones, t.a1 FROM tot t
    UNION ALL
    SELECT 2, (SELECT ties FROM n2), t.operaciones, t.a2 FROM tot t
    ORDER BY 1;
$$;


COMMENT ON FUNCTION racha3_lados_jugadas(timestamptz, timestamptz) IS
    'Distribución de ganadores en jugadas hasta el checkpoint. Base para '
    'estimar la ventaja del lado apostado con ~9x mas muestra que a nivel '
    'de oportunidad. Descriptiva. Ver ANALYTICS.md.';

COMMENT ON FUNCTION racha3_ties_por_nivel(text, timestamptz, timestamptz, boolean, boolean) IS
    'TIEs ocurridos dentro de operaciones, por nivel de la escalera. '
    'Devuelve conteos: el coste depende de la escalera y del porcentaje de '
    'devolucion, que son parametros del Core. Ver ANALYTICS.md.';

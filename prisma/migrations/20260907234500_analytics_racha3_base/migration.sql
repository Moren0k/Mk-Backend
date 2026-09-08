-- =====================================================================
-- F1 - Base del sistema de Analytics histórico "Racha 3".
--
-- Alcance de esta migración: SOLO tablas, índices, constraints y FKs.
-- Las funciones plpgsql (rebuild/incremental) y las vistas de agregación
-- llegan en F2/F4/F6, cada una en su propia migración.
--
-- Invariantes de diseño que esta migración materializa (ver DATABASE.md
-- §11 y el ADR "Analytics Racha 3" en Mk-Api.md):
--
--  1. `jugadas` es la ÚNICA fuente de verdad. Esta migración NO la altera:
--     no agrega columnas, no agrega índices, no toca datos. Las relaciones
--     inversas que aparecen en schema.prisma (`Jugada.columnasIniciadas`,
--     etc.) son campos virtuales de Prisma, sin representación física en
--     la tabla.
--
--  2. Todo lo que se crea aquí es DERIVADO y reconstruible desde `jugadas`.
--     `TRUNCATE columnas RESTART IDENTITY CASCADE` debe poder ejecutarse
--     en cualquier momento sin pérdida de información real.
--
--  3. Las claves de idempotencia NO son secuencias: son claves naturales
--     derivadas de `jugadas` - `columnas.inicio_jugada_id` UNIQUE y
--     `racha3_operaciones.columna_id` UNIQUE. Reejecutar el mismo rango no
--     puede duplicar nada porque esas dos claves solo dependen de `jugadas`,
--     que es inmutable.
--
--     PENDIENTE DE DECIDIR EN F2 - cómo se reescribe el tramo rebobinado:
--       (a) DELETE del tramo + INSERT: más simple, pero `columnas.id` y
--           `racha3_operaciones.id` cambian en cada corrida para las últimas
--           filas (churn de secuencia, irrelevante en volumen pero hace que
--           esos ids no sirvan como referencia estable ni siquiera dentro
--           del dominio).
--       (b) UPSERT `ON CONFLICT (<clave natural>) DO UPDATE`: ids estables,
--           pero hay que borrar explícitamente las filas del tramo que ya no
--           corresponden (p. ej. una columna que un gap recién descubierto
--           partió en dos).
--     Ambas son idempotentes. El esquema soporta las dos; la elección es de
--     F2 y debe quedar documentada allí, no aquí.
--
--  4. Umbral de discontinuidad: 120000 ms (120 s) entre `jugada_en`
--     consecutivas. La cadencia real medida de la mesa es 29,6-40 s
--     (39.836 de 42.331 deltas), así que 120 s es ~3,6x la cadencia normal.
--     Sobre el histórico actual dispara 19 veces. Este número NO se
--     hardcodea aquí: vive como parámetro de la función de F2, y esta
--     migración solo provee las columnas donde se registra su efecto
--     (`columnas.corte_por_gap` / `columnas.cerrada_por_gap`).
--
--  5. Zona horaria única para analítica horaria: 'America/Bogota'.
--     `AT TIME ZONE '<nombre>'` es STABLE, no IMMUTABLE, así que PostgreSQL
--     PROHÍBE usarlo en GENERATED ... STORED o en un índice de expresión.
--     Por eso `hora_col_*` son columnas normales que escribe la función de
--     procesamiento, nunca generadas. La invariante V9 (F2) las recalcula y
--     exige 0 diferencias.
--
--  6. Lock de exclusión mutua para todo procesamiento de este dominio
--     (REBUILD e INCREMENTAL comparten el mismo):
--     `pg_advisory_xact_lock(42, 3)` - 42 = espacio 'analytics',
--     3 = proceso 'racha3'. Reservado aquí para que F2 y F4 usen
--     exactamente el mismo par y nunca puedan solaparse.
-- =====================================================================


-- ---------------------------------------------------------------------
-- columnas - corridas continuas observadas del mismo ganador.
--
-- PLAYER, BANKER y TIE son tipos de columna independientes: un TIE siempre
-- rompe la columna de PLAYER/BANKER y forma la suya propia.
--
-- Una columna es una corrida *observada*: nunca se fusiona a través de una
-- discontinuidad temporal, porque no hay evidencia de qué ocurrió en el
-- hueco. Si dos jugadas del mismo ganador quedan separadas por más del
-- umbral, se cortan en dos columnas y la segunda se marca con
-- `corte_por_gap`. Consecuencia deliberada: pueden existir dos columnas
-- adyacentes del MISMO tipo, y eso es válido si y solo si la segunda tiene
-- `corte_por_gap = true` (invariante V3 de F2). Sobre el histórico actual
-- ocurre 8 veces.
--
-- Diseñada para soportar el futuro concepto "L" (columna PLAYER/BANKER con
-- longitud >= 6) sin volver a interpretar `jugadas`: basta consultar
-- (tipo, longitud), y `cerrada_por_gap` advierte cuándo la longitud
-- observada pudo quedar truncada por la derecha.
--
-- NO existe una columna `cerrada`: sería estado redundante - la única
-- columna extensible es siempre `max(id)`, y el punto de rebobinado del
-- procesamiento incremental (`analytics_checkpoints.reproceso_desde_jugada_id`)
-- ya la cubre por construcción.
-- ---------------------------------------------------------------------
CREATE TABLE "columnas" (
    -- PK secuencial interna. Efímera por definición: un REBUILD la reinicia.
    -- Nada fuera de este dominio debe guardar referencias a este id.
    "id"               BIGSERIAL      NOT NULL,

    -- Copia de `jugadas.ganador` (PLAYER/BANKER/TIE). Sin CHECK, a
    -- propósito y por el mismo criterio que `jugadas.ganador`: si Tipminer
    -- introduce un valor nuevo, un REBUILD completo nunca debe abortar por
    -- eso. La protección real está del otro lado: `racha3_operaciones` se
    -- genera con un filtro POSITIVO (tipo IN ('PLAYER','BANKER')), nunca
    -- con `tipo <> 'TIE'` - que dejaría pasar un valor desconocido y
    -- fabricaría oportunidades inexistentes.
    "tipo"             VARCHAR(20)    NOT NULL,

    -- Cantidad de jugadas consecutivas observadas en esta corrida.
    "longitud"         INTEGER        NOT NULL,

    -- Clave natural de idempotencia: la primera jugada de la corrida.
    -- UNIQUE más abajo. Es lo que convierte el procesamiento incremental en
    -- un UPSERT reentrante en vez de un append con estado.
    "inicio_jugada_id" BIGINT         NOT NULL,
    "fin_jugada_id"    BIGINT         NOT NULL,

    -- Desnormalización deliberada de `jugadas.jugada_en` (inicio y fin):
    -- evita un JOIN en toda agregación temporal, y son inmutables porque
    -- `jugadas` es append-only.
    "inicio_en"        TIMESTAMPTZ(3) NOT NULL,
    "fin_en"           TIMESTAMPTZ(3) NOT NULL,

    -- true: esta columna EMPIEZA por una discontinuidad temporal, no por un
    -- cambio de ganador. Su longitud observada puede ser una fracción de
    -- una corrida real más larga, así que cualquier Racha 3 derivada de
    -- ella nace con `integridad_ok = false`.
    "corte_por_gap"    BOOLEAN        NOT NULL DEFAULT false,

    -- true: la columna siguiente empieza por gap, es decir esta TERMINA en
    -- una discontinuidad y su longitud puede estar truncada por la derecha.
    -- Denormalización de `siguiente.corte_por_gap`, escrita en la misma
    -- pasada; existe para que el futuro análisis de "L" pueda descartar
    -- longitudes no confiables con un solo predicado.
    "cerrada_por_gap"  BOOLEAN        NOT NULL DEFAULT false,

    CONSTRAINT "columnas_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "columnas_longitud_check"
        CHECK ("longitud" >= 1),
    CONSTRAINT "columnas_rango_ids_check"
        CHECK ("fin_jugada_id" >= "inicio_jugada_id"),
    CONSTRAINT "columnas_rango_tiempo_check"
        CHECK ("fin_en" >= "inicio_en"),
    -- Una columna de longitud 1 empieza y termina en la misma jugada.
    CONSTRAINT "columnas_longitud_unitaria_check"
        CHECK ("longitud" > 1 OR "fin_jugada_id" = "inicio_jugada_id")
);

-- Clave natural de idempotencia. También es el índice que sirve al
-- `DELETE FROM columnas WHERE inicio_jugada_id >= <rebobinado>` del
-- procesamiento incremental.
CREATE UNIQUE INDEX "columnas_inicio_jugada_id_key"
    ON "columnas"("inicio_jugada_id");

-- Soporta el futuro concepto "L": tipo IN ('PLAYER','BANKER') AND longitud >= 6.
CREATE INDEX "columnas_tipo_longitud_idx"
    ON "columnas"("tipo", "longitud");

-- Localiza la columna abierta y resuelve el join hacia la jugada final.
CREATE INDEX "columnas_fin_jugada_id_idx"
    ON "columnas"("fin_jugada_id");


-- ---------------------------------------------------------------------
-- racha3_operaciones - una fila por OPORTUNIDAD Racha 3.
--
-- Semántica A ("oportunidad pura"), decidida explícitamente: toda columna
-- PLAYER/BANKER que alcanza longitud 3 produce exactamente una fila,
-- confirmada en su 3.a jugada, con independencia de si el motor de alertas
-- habría podido operarla en ese instante. Motivos: (a) es reconstruible
-- desde `jugadas` sin máquina de estados con memoria, que es lo que hace
-- posible la idempotencia; (b) el guard de concurrencia del motor es una
-- restricción de EJECUCIÓN, no una propiedad del juego.
--
-- La restricción de ejecución no se pierde: queda registrada en
-- `bloqueada_por_operacion_previa`. El Core las EXCLUYE por defecto; la API
-- permite incluirlas explícitamente para análisis histórico completo.
--
-- Relación 1:1 estricta con `columnas` (UNIQUE(columna_id)): la oportunidad
-- y su operación simulada viven en la misma fila. No se separan en dos
-- tablas porque no existe ningún caso en que una columna produzca dos
-- operaciones ni una operación pertenezca a dos columnas.
--
-- Trazabilidad por FK, nunca por listas JSON de uuids: los uuid originales
-- se recuperan con JOIN a `jugadas`, sin duplicar el dato.
-- ---------------------------------------------------------------------
CREATE TABLE "racha3_operaciones" (
    "id"                     BIGSERIAL      NOT NULL,

    -- Clave natural de idempotencia (UNIQUE más abajo).
    "columna_id"             BIGINT         NOT NULL,

    -- PLAYER | BANKER. Aquí SÍ hay CHECK, al revés que en `columnas.tipo`:
    -- que una Racha 3 sea de PLAYER o BANKER no es un dato que venga del
    -- proveedor, es la definición misma de la entidad.
    "tipo_racha"             VARCHAR(20)    NOT NULL,
    -- Siempre el opuesto de `tipo_racha`. Se persiste en vez de derivarse
    -- para que la fila sea auditable sin conocer la regla vigente.
    "apuesta"                VARCHAR(20)    NOT NULL,

    -- Anclaje a jugadas. `jugada_inicio_id` = 1.a jugada de la corrida;
    -- `jugada_confirmacion_id` = 3.a jugada consecutiva (momento en que la
    -- Racha 3 queda confirmada y a partir del cual se apuesta).
    "jugada_inicio_id"       BIGINT         NOT NULL,
    "jugada_confirmacion_id" BIGINT         NOT NULL,

    -- Escalera de martingala. Cada una apunta a la jugada concreta que se
    -- evaluó en ese nivel; NULL = ese nivel nunca se alcanzó.
    -- Los TIE intercalados NO ocupan ninguno de estos slots (son neutrales:
    -- no cuentan como victoria ni derrota y no avanzan el nivel); su
    -- cantidad queda en `ties_en_operacion`.
    "jugada_directa_id"      BIGINT,
    "jugada_mg1_id"          BIGINT,
    "jugada_mg2_id"          BIGINT,
    -- Redundante por diseño con COALESCE(mg2, mg1, directa) - hay un CHECK
    -- que lo impone. Existe para que las consultas de resolución no tengan
    -- que replicar esa expresión.
    "jugada_resolucion_id"   BIGINT,

    "inicio_en"              TIMESTAMPTZ(3) NOT NULL,
    "confirmacion_en"        TIMESTAMPTZ(3) NOT NULL,
    "resuelta_en"            TIMESTAMPTZ(3),

    -- PENDIENTE: la operación aún no se resolvió al final del rango
    -- procesado (el historial se acabó antes que la operación). Debe
    -- sobrevivir entre lotes y reevaluarse en cada corrida incremental.
    -- RESUELTA: tiene resultado_final definitivo.
    "estado"                 VARCHAR(12)    NOT NULL,

    -- DIRECTA | MG1 | MG2 | LOSS.
    -- Mapeo con el motor (core/enums/operation-state.enum.ts), que no tiene
    -- concepto de DIRECTA:
    --   DIRECTA <=> OperationState.WON con currentMartingale = 0
    --   MG1     <=> OperationState.WON con currentMartingale = 1
    --   MG2     <=> OperationState.WON con currentMartingale = 2
    --   LOSS    <=> OperationState.LOST
    -- Se persiste y NO se deriva de `columnas.longitud`: sobre el histórico
    -- actual hay 491 LOSS pero solo 338 columnas P/B de longitud >= 6,
    -- porque un TIE parte la columna pero no parte la operación - una
    -- operación puede perder repartida entre dos columnas distintas.
    "resultado_final"        VARCHAR(10),

    -- Valor de maxMartingales usado para simular ESTA operación. Se
    -- persiste porque en el motor es mutable en runtime vía API
    -- (StrategyConfigProvider / Mk-Api.md Anexo E.3): sin esta columna, un
    -- cambio de configuración invalidaría en silencio todo el histórico.
    "max_martingalas"        SMALLINT       NOT NULL DEFAULT 2,

    -- Derivados básicos. `duracion_ms` no es métrica prioritaria hoy; se
    -- conserva porque es gratis calcularla en la misma pasada.
    "duracion_ms"            BIGINT,
    -- Jugadas evaluadas desde la confirmación hasta la resolución,
    -- incluyendo los TIE neutrales. Máximo observado sobre el histórico: 7.
    "jugadas_evaluadas"      INTEGER,
    "ties_en_operacion"      INTEGER,

    -- Distancias respecto de la Racha 3 INMEDIATAMENTE anterior en orden de
    -- confirmación, contando TODAS las filas (también las bloqueadas y las
    -- de integridad dudosa). Es una propiedad de la secuencia observada;
    -- las vistas recalculan la distancia sobre subconjuntos filtrados
    -- cuando hace falta. NULL en la primera fila del histórico.
    "jugadas_desde_anterior"  INTEGER,
    "columnas_desde_anterior" INTEGER,
    "segundos_desde_anterior" INTEGER,

    -- Hora del día en 'America/Bogota' (0-23). Columnas normales, NO
    -- generadas: `AT TIME ZONE` con nombre de zona es STABLE y PostgreSQL
    -- no admite STABLE en GENERATED STORED ni en índices de expresión.
    -- Colombia no aplica DST (offset fijo -05:00), pero igual se usa SIEMPRE
    -- el nombre de zona, nunca aritmética de offsets.
    "hora_col_inicio"        SMALLINT       NOT NULL,
    "hora_col_confirmacion"  SMALLINT       NOT NULL,
    "hora_col_resolucion"    SMALLINT,

    -- true: en el instante de la confirmación seguía abierta la operación de
    -- una Racha 3 anterior, así que el motor real NO habría podido emitir
    -- alerta aquí. Sobre el histórico actual: 50 de 4.102 filas. Causa raíz
    -- verificada: un TIE dentro de una operación abre una columna nueva que
    -- alcanza longitud 3 en la misma jugada que resuelve la operación previa
    -- (p. ej. P P P | T | P P P). El Core las excluye por defecto.
    "bloqueada_por_operacion_previa" BOOLEAN NOT NULL DEFAULT false,

    -- false: hay una discontinuidad temporal (> umbral) dentro de la ventana
    -- [jugada_inicio_id .. jugada_resolucion_id], o justo antes del inicio de
    -- la corrida. La fila es sospechosa: faltan rondas reales.
    -- Sobre el histórico actual: 10 de 4.102 filas (0,24 %).
    "integridad_ok"          BOOLEAN        NOT NULL DEFAULT true,

    -- Cuándo la calculó por última vez el proceso derivado. Es metadato de
    -- auditoría del pipeline, no del juego.
    -- OJO F2: un DEFAULT solo se aplica en el INSERT. Si el incremental usa
    -- `ON CONFLICT DO UPDATE`, tiene que asignar `procesada_en` de forma
    -- explícita o la fila conservará para siempre el instante de su primer
    -- cálculo, que es justo lo contrario de lo que esta columna promete.
    "procesada_en"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "racha3_operaciones_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "racha3_operaciones_tipo_racha_check"
        CHECK ("tipo_racha" IN ('PLAYER', 'BANKER')),
    CONSTRAINT "racha3_operaciones_apuesta_check"
        CHECK ("apuesta" IN ('PLAYER', 'BANKER')),
    -- Si la racha es PLAYER la apuesta es BANKER y viceversa. Siempre.
    CONSTRAINT "racha3_operaciones_apuesta_opuesta_check"
        CHECK ("apuesta" <> "tipo_racha"),

    CONSTRAINT "racha3_operaciones_estado_check"
        CHECK ("estado" IN ('PENDIENTE', 'RESUELTA')),
    CONSTRAINT "racha3_operaciones_resultado_final_check"
        CHECK ("resultado_final" IS NULL
               OR "resultado_final" IN ('DIRECTA', 'MG1', 'MG2', 'LOSS')),

    -- RESUELTA <=> tiene resultado, instante y jugada de resolución. Las
    -- tres a la vez o ninguna: no existe un estado intermedio.
    CONSTRAINT "racha3_operaciones_resuelta_coherente_check"
        CHECK ((("estado" = 'RESUELTA') = ("resultado_final"      IS NOT NULL))
           AND (("estado" = 'RESUELTA') = ("resuelta_en"          IS NOT NULL))
           AND (("estado" = 'RESUELTA') = ("jugada_resolucion_id" IS NOT NULL))),

    -- Todos los derivados de la resolución existen si y solo si la
    -- operación está RESUELTA. Sin esto, una fila RESUELTA podía quedar con
    -- `hora_col_resolucion`, `duracion_ms`, `jugadas_evaluadas` o
    -- `ties_en_operacion` en NULL y pasar todos los demás CHECK: es
    -- justamente la clase de bug parcial que F2 puede introducir al
    -- reevaluar una operación PENDIENTE (actualiza el estado pero olvida
    -- algún derivado). `hora_col_resolucion` va como bicondicional estricto
    -- porque se deriva 1:1 de `resuelta_en`.
    CONSTRAINT "racha3_operaciones_derivados_resolucion_check"
        CHECK ((("resuelta_en" IS NOT NULL) = ("hora_col_resolucion" IS NOT NULL))
           AND ("estado" <> 'RESUELTA'
                OR ("duracion_ms"       IS NOT NULL
                AND "jugadas_evaluadas" IS NOT NULL
                AND "ties_en_operacion" IS NOT NULL))),

    -- La escalera de martingala no puede saltarse niveles.
    CONSTRAINT "racha3_operaciones_escalera_check"
        CHECK (("jugada_mg1_id" IS NULL OR "jugada_directa_id" IS NOT NULL)
           AND ("jugada_mg2_id" IS NULL OR "jugada_mg1_id"     IS NOT NULL)),

    -- El resultado debe corresponder al nivel realmente alcanzado.
    CONSTRAINT "racha3_operaciones_resultado_escalera_check"
        CHECK ("resultado_final" IS NULL
           OR ("resultado_final" = 'DIRECTA'
               AND "jugada_directa_id" IS NOT NULL AND "jugada_mg1_id" IS NULL)
           OR ("resultado_final" = 'MG1'
               AND "jugada_mg1_id" IS NOT NULL AND "jugada_mg2_id" IS NULL)
           OR ("resultado_final" IN ('MG2', 'LOSS')
               AND "jugada_mg2_id" IS NOT NULL)),

    -- `jugada_resolucion_id` es exactamente el último nivel alcanzado.
    CONSTRAINT "racha3_operaciones_resolucion_identidad_check"
        CHECK ("jugada_resolucion_id" IS NULL
               OR "jugada_resolucion_id" = COALESCE("jugada_mg2_id",
                                                    "jugada_mg1_id",
                                                    "jugada_directa_id")),

    -- La confirmación es la 3.a jugada de la corrida: siempre posterior al
    -- inicio (los ids son estrictamente crecientes en orden cronológico).
    CONSTRAINT "racha3_operaciones_orden_ids_check"
        CHECK ("jugada_confirmacion_id" > "jugada_inicio_id"),
    CONSTRAINT "racha3_operaciones_orden_tiempo_check"
        CHECK ("confirmacion_en" >= "inicio_en"
               AND ("resuelta_en" IS NULL OR "resuelta_en" >= "confirmacion_en")),

    CONSTRAINT "racha3_operaciones_max_martingalas_check"
        CHECK ("max_martingalas" >= 0),
    CONSTRAINT "racha3_operaciones_duracion_check"
        CHECK ("duracion_ms" IS NULL OR "duracion_ms" >= 0),
    -- `jugadas_evaluadas >= 0`, no `>= 1`: una operación recién confirmada
    -- en la última jugada del rango procesado queda PENDIENTE con cero
    -- jugadas evaluadas todavía. Para las RESUELTA el mínimo real es 1, y
    -- eso lo garantiza `racha3_operaciones_resultado_escalera_check` (exige
    -- al menos `jugada_directa_id`), no este contador.
    CONSTRAINT "racha3_operaciones_contadores_check"
        CHECK (("jugadas_evaluadas" IS NULL OR "jugadas_evaluadas" >= 0)
           AND ("ties_en_operacion" IS NULL OR "ties_en_operacion" >= 0)),
    CONSTRAINT "racha3_operaciones_distancias_check"
        CHECK (("jugadas_desde_anterior"  IS NULL OR "jugadas_desde_anterior"  > 0)
           AND ("columnas_desde_anterior" IS NULL OR "columnas_desde_anterior" > 0)
           AND ("segundos_desde_anterior" IS NULL OR "segundos_desde_anterior" >= 0)),

    CONSTRAINT "racha3_operaciones_hora_col_check"
        CHECK ("hora_col_inicio"       BETWEEN 0 AND 23
           AND "hora_col_confirmacion" BETWEEN 0 AND 23
           AND ("hora_col_resolucion" IS NULL
                OR "hora_col_resolucion" BETWEEN 0 AND 23))
);

-- Clave natural de idempotencia: una columna produce a lo sumo una Racha 3.
-- Es lo que permite reescribir el tramo rebobinado sin contadores ni marcas
-- de lote (ver la nota 3 de la cabecera sobre DELETE+INSERT vs UPSERT).
CREATE UNIQUE INDEX "racha3_operaciones_columna_id_key"
    ON "racha3_operaciones"("columna_id");

-- Segunda clave natural, independiente de `columnas`: red de seguridad
-- frente a un bug de reconstrucción de columnas que produjera dos
-- oportunidades confirmadas en la misma jugada.
CREATE UNIQUE INDEX "racha3_operaciones_jugada_confirmacion_id_key"
    ON "racha3_operaciones"("jugada_confirmacion_id");

-- Filtros por ventana temporal y ORDER BY de la API.
CREATE INDEX "racha3_operaciones_confirmacion_en_idx"
    ON "racha3_operaciones"("confirmacion_en" DESC);

-- NOTA deliberada - índices que NO se crean, y por qué:
--
--  * (resultado_final, tipo_racha) y (hora_col_confirmacion): con ~4.100
--    filas PostgreSQL hace seq scan de todas formas y el índice sería ruido.
--
--  * Índice parcial `WHERE estado = 'PENDIENTE'`: sobre el histórico actual
--    hay 0 filas PENDIENTE y en régimen habrá 0 o 1. Además Prisma no puede
--    representar índices parciales en schema.prisma, así que crearlo aquí
--    dejaría una diferencia permanente entre la base y el modelo, con riesgo
--    de que un `prisma migrate dev` posterior genere un DROP INDEX.
--
-- Todos se reevalúan cuando se cruce el umbral ya acordado: ~500k filas o
-- p95 > 200 ms en algún endpoint (~5 años al ritmo actual de ~250
-- oportunidades/día).


-- ---------------------------------------------------------------------
-- analytics_checkpoints - hasta dónde procesó cada proceso derivado.
-- Una fila por proceso ('racha3' es el único en v1).
--
-- Ausencia de fila = nunca se procesó. Es un estado legítimo, no un error:
-- la crea el REBUILD de F2.
-- ---------------------------------------------------------------------
CREATE TABLE "analytics_checkpoints" (
    "proceso"                   VARCHAR(40)    NOT NULL,

    -- Última jugada efectivamente procesada. Marca de agua, NUNCA extremo de
    -- un rango cerrado: `jugadas.id` tiene huecos (579 ids consumidos sin
    -- fila, por el ON CONFLICT DO NOTHING del batcher de Mk-Ingestion-Service).
    -- Todo recorrido es `id > checkpoint ORDER BY id`; `id BETWEEN a AND b`
    -- está prohibido en este dominio.
    "ultima_jugada_id"          BIGINT         NOT NULL,

    -- `jugada_en` de esa misma jugada. Existe para detectar inserciones
    -- retroactivas: si aparece una jugada con id mayor pero `jugada_en`
    -- anterior a este valor, el orden por id dejó de ser cronológico y el
    -- procesamiento incremental debe abortar y exigir REBUILD. Hoy la
    -- monotonicidad id<->jugada_en se cumple (0 desórdenes sobre 42.367
    -- filas) pero es empírica, no estructural: depende de que haya un solo
    -- escritor (Mk-Ingestion-Service).
    "ultima_jugada_en"          TIMESTAMPTZ(3) NOT NULL,

    -- Punto de rebobinado seguro: desde aquí relee el incremental, NO desde
    -- `ultima_jugada_id`. Es el mínimo entre el inicio de la columna abierta
    -- y la confirmación de la operación PENDIENTE más antigua. Es lo que hace
    -- correcta la frontera de lote: la columna abierta se extiende en vez de
    -- duplicarse, y las operaciones pendientes se reevalúan.
    "reproceso_desde_jugada_id" BIGINT         NOT NULL,

    "ultima_ejecucion_id"       BIGINT,
    "actualizado_en"            TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "analytics_checkpoints_pkey" PRIMARY KEY ("proceso"),
    CONSTRAINT "analytics_checkpoints_rebobinado_check"
        CHECK ("reproceso_desde_jugada_id" <= "ultima_jugada_id")
);


-- ---------------------------------------------------------------------
-- analytics_ejecuciones - bitácora de cada corrida del procesamiento.
-- Responde éxito / error / reintento / duplicado sin adivinar.
--
-- Se inserta UNA sola fila, al final, con el estado definitivo - no hay
-- estado 'EN_CURSO'. Motivo: plpgsql no tiene transacciones autónomas, así
-- que una fila 'EN_CURSO' escrita al inicio desaparecería en el ROLLBACK que
-- provoca el propio fallo que se quiere registrar. F2/F4 envuelven el trabajo
-- en un bloque BEGIN ... EXCEPTION (savepoint implícito), capturan el error, y
-- recién entonces insertan aquí: el trabajo se revierte, la bitácora sobrevive.
--
-- Un crash duro (conexión cortada) no deja fila. La señal en ese caso es el
-- checkpoint que no avanzó, expuesto por GET /api/v1/analytics/racha3/estado.
-- ---------------------------------------------------------------------
CREATE TABLE "analytics_ejecuciones" (
    "id"                    BIGSERIAL      NOT NULL,
    "proceso"               VARCHAR(40)    NOT NULL,
    "tipo"                  VARCHAR(12)    NOT NULL,
    "estado"                VARCHAR(12)    NOT NULL,

    -- Rango realmente recorrido. `desde_jugada_id` es el punto de rebobinado,
    -- no `ultima_jugada_id + 1`.
    "desde_jugada_id"       BIGINT,
    "hasta_jugada_id"       BIGINT,

    "jugadas_leidas"        INTEGER,
    "columnas_afectadas"    INTEGER,
    "operaciones_afectadas" INTEGER,
    "duracion_ms"           INTEGER,
    "error"                 TEXT,

    "iniciado_en"           TIMESTAMPTZ(3) NOT NULL,
    "terminado_en"          TIMESTAMPTZ(3),

    CONSTRAINT "analytics_ejecuciones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_ejecuciones_tipo_check"
        CHECK ("tipo" IN ('REBUILD', 'INCREMENTAL')),
    CONSTRAINT "analytics_ejecuciones_estado_check"
        CHECK ("estado" IN ('OK', 'ERROR')),
    -- Un ERROR siempre trae mensaje; un OK nunca lo trae.
    CONSTRAINT "analytics_ejecuciones_error_coherente_check"
        CHECK (("estado" = 'ERROR') = ("error" IS NOT NULL)),
    CONSTRAINT "analytics_ejecuciones_orden_tiempo_check"
        CHECK ("terminado_en" IS NULL OR "terminado_en" >= "iniciado_en")
);

CREATE INDEX "analytics_ejecuciones_proceso_iniciado_en_idx"
    ON "analytics_ejecuciones"("proceso", "iniciado_en" DESC);


-- ---------------------------------------------------------------------
-- Claves foráneas.
--
-- Hacia `jugadas`: ON DELETE RESTRICT / ON UPDATE CASCADE. `jugadas` es
-- append-only, así que RESTRICT nunca debería dispararse - y ese es
-- justamente el punto: convierte "alguien borró historial" en un error
-- ruidoso en vez de en datos derivados apuntando al vacío.
--
-- De `racha3_operaciones` hacia `columnas`: ON DELETE CASCADE, para que el
-- `TRUNCATE columnas RESTART IDENTITY CASCADE` del REBUILD limpie ambas de un
-- golpe y nunca queden oportunidades huérfanas.
--
-- No se crean índices para las FKs `jugada_inicio_id`, `jugada_directa_id`,
-- `jugada_mg1_id`, `jugada_mg2_id` ni `jugada_resolucion_id`: PostgreSQL solo
-- necesita índice del lado hijo cuando la fila PADRE se borra o actualiza, y
-- en `jugadas` eso no ocurre nunca.
-- ---------------------------------------------------------------------
ALTER TABLE "columnas"
    ADD CONSTRAINT "columnas_inicio_jugada_id_fkey"
    FOREIGN KEY ("inicio_jugada_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "columnas"
    ADD CONSTRAINT "columnas_fin_jugada_id_fkey"
    FOREIGN KEY ("fin_jugada_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "racha3_operaciones"
    ADD CONSTRAINT "racha3_operaciones_columna_id_fkey"
    FOREIGN KEY ("columna_id") REFERENCES "columnas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "racha3_operaciones"
    ADD CONSTRAINT "racha3_operaciones_jugada_inicio_id_fkey"
    FOREIGN KEY ("jugada_inicio_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "racha3_operaciones"
    ADD CONSTRAINT "racha3_operaciones_jugada_confirmacion_id_fkey"
    FOREIGN KEY ("jugada_confirmacion_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "racha3_operaciones"
    ADD CONSTRAINT "racha3_operaciones_jugada_directa_id_fkey"
    FOREIGN KEY ("jugada_directa_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "racha3_operaciones"
    ADD CONSTRAINT "racha3_operaciones_jugada_mg1_id_fkey"
    FOREIGN KEY ("jugada_mg1_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "racha3_operaciones"
    ADD CONSTRAINT "racha3_operaciones_jugada_mg2_id_fkey"
    FOREIGN KEY ("jugada_mg2_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "racha3_operaciones"
    ADD CONSTRAINT "racha3_operaciones_jugada_resolucion_id_fkey"
    FOREIGN KEY ("jugada_resolucion_id") REFERENCES "jugadas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "analytics_checkpoints"
    ADD CONSTRAINT "analytics_checkpoints_ultima_ejecucion_id_fkey"
    FOREIGN KEY ("ultima_ejecucion_id") REFERENCES "analytics_ejecuciones"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

# ANALYTICS.md — Analytics histórico de la estrategia "Racha 3"

> Estado al 2026-09-08. Implementado y aplicado sobre la base real (5 migraciones, `20260907234500` a `20260908040000`). Este documento es la referencia única del dominio: si algo cambia en `src/core/analytics/`, `src/application/analytics/`, `src/infrastructure/persistence/analytics/`, `src/api/resources/analytics/` o en las migraciones de Analytics, se actualiza acá.

---

## 0. Lo que hay que entender antes de usar cualquier número

**Analytics no predice y no decide alertas.** Describe lo que ya ocurrió y entrega evidencia histórica. La decisión de alertar o no la mantiene íntegramente el Core, que combina su ventana de ~200 jugadas en memoria con estas estadísticas y aplica sus propias reglas.

Esa separación no es una formalidad organizativa: es la razón por la que ninguna columna, campo JSON o nombre de función de este dominio se llama `probabilidad`, `prediccion` ni `confianza`. Convertir una frecuencia histórica en una probabilidad predictiva exige supuestos (independencia entre rondas, estacionariedad del proceso, que el futuro se parezca al pasado) que **estos datos no contienen y no pueden justificar**. Quien quiera hacer esa conversión debe hacerla explícitamente, asumiendo sus supuestos, y ese lugar es el Core.

Tres magnitudes que se confunden con facilidad y que por eso viajan siempre con nombres distintos:

| Nombre | Qué es | Suma 1 |
|---|---|---|
| `frecuencia_historica` | Proporción de los casos observados que cayeron en una categoría | **Sí**, sobre todas las categorías |
| `tasa_empirica_condicionada` | Proporción de veces que ocurrió el evento **entre los casos que llegaron a estar en riesgo** de que ocurriera (hazard empírico) | **No** |
| `muestra_n` | Tamaño de muestra detrás de cada tasa | — |

`frecuencia_historica` y `tasa_empirica_condicionada` **no son comparables entre sí**. Sobre el histórico actual llegan incluso a ordenar los buckets al revés: el bucket `0-5` es el segundo más frecuente (0,25 de los intervalos) y a la vez el de menor tasa condicionada (0,053). Leer uno creyendo estar leyendo el otro es el error más fácil de cometer en todo el dominio.

**Toda tasa viene acompañada de su `muestra_n`.** Una tasa sin su n no es información: con ~170 observaciones por hora, una diferencia de varios puntos entre dos horas es perfectamente compatible con el azar. Una hora no es mejor por tener mejor tasa.

---

## 1. Definiciones del dominio

### 1.1 Columna

Una **columna** es una corrida continua *observada* del mismo ganador. `PLAYER`, `BANKER` y `TIE` son tipos de columna independientes: un TIE siempre rompe la columna de PLAYER/BANKER y forma la suya propia.

```
P P P T B    ->  PLAYER:3, TIE:1, BANKER:1
P T P        ->  PLAYER:1, TIE:1, PLAYER:1
P P P T T T T B  ->  PLAYER:3, TIE:4, BANKER:1
```

### 1.2 Gap: el umbral de 120000 ms

Una columna nunca se fusiona a través de una **discontinuidad temporal** mayor a **120000 ms (120 s)**. Del otro lado de un hueco no hay evidencia de qué ocurrió, así que unir las dos puntas sería inventar una corrida que nunca se observó.

- La cadencia real medida de la mesa es **29,6 s – 40 s** (39.836 de 42.331 deltas en la medición inicial), así que 120 s es ~3,6× lo normal.
- Sobre el histórico dispara **19 veces**. Dos huecos son grandes: uno de **3,3 h** (~361 rondas perdidas de forma irrecuperable, porque excede la ventana de 200 rondas que devuelve Tipminer) y uno de **15 min** (~28 rondas).
- En **8** de esos 19 huecos coincide el ganador a ambos lados, así que fusionar habría fabricado columnas inexistentes.

**Consecuencia deliberada:** pueden existir dos columnas adyacentes del mismo tipo, y es válido **si y solo si** la segunda tiene `corte_por_gap = true`. Es exactamente lo que verifica la invariante V3.

El umbral es un parámetro de las funciones (`p_umbral_ms`), no un valor hardcodeado. Cambiarlo exige un rebuild completo, porque redefine las columnas.

### 1.3 Racha 3

Una **Racha 3** es **una oportunidad por cada columna PLAYER/BANKER que alcanza longitud 3**. Empieza en la primera jugada de la corrida y queda **confirmada en la tercera** jugada consecutiva del mismo ganador.

```
B P P P              ->  UNA Racha 3 PLAYER. inicio = 1.er P, confirmación = 3.er P
B P P P P P P B      ->  UNA sola Racha 3 (no cuatro): una corrida = una oportunidad
B P P T P            ->  NINGUNA: el TIE rompió la formación
```

Una columna TIE nunca genera oportunidad, por larga que sea.

El filtro es **positivo** — `tipo IN ('PLAYER','BANKER')`, nunca `tipo <> 'TIE'`. Si Tipminer introdujera un valor de `ganador` nuevo, el filtro negativo lo dejaría pasar y fabricaría oportunidades inexistentes; el positivo lo ignora, y la invariante V0 lo denuncia por separado.

### 1.4 La operación

Al confirmarse una Racha 3 se abre una operación que apuesta al **opuesto**: racha PLAYER → apuesta BANKER, y viceversa. Se apuesta desde la jugada **siguiente** a la confirmación.

| Resultado | Significado |
|---|---|
| `DIRECTA` | Ganó en la primera apuesta |
| `MG1` | Perdió una, ganó en la segunda |
| `MG2` | Perdió dos, ganó en la tercera |
| `LOSS` | Perdió las tres (`max_martingalas = 2`) |
| `PENDIENTE` | Todavía sin resolver al final del rango procesado |

**Un TIE durante la operación es neutral**: no cuenta como victoria ni como derrota, no incrementa el nivel de martingala y no cierra la operación. Se repite la apuesta anterior.

```
P P P B          ->  DIRECTA
P P P P B        ->  MG1
P P P P P B      ->  MG2
P P P P P P      ->  LOSS
P P P T P        ->  el TIE es neutral; el P pierde la directa -> PENDIENTE en MG1
P P P T P P P    ->  LOSS, con 1 TIE y 4 jugadas evaluadas
P P P T T T T B  ->  DIRECTA, con 4 TIEs neutrales y 5 jugadas evaluadas
```

Los TIEs **no tienen tope**: el máximo observado dentro de una operación es 4, y el máximo de jugadas evaluadas es 7, pero ninguno de los dos es un límite del diseño. La escalera apunta siempre a las primeras N jugadas PLAYER/BANKER posteriores a la confirmación, y los TIEs intercalados se cuentan aparte en `ties_en_operacion`.

**Mapeo con el motor de alertas** (`src/core/enums/operation-state.enum.ts`), que no tiene el concepto de "DIRECTA":

| Analytics | Motor |
|---|---|
| `DIRECTA` | `OperationState.WON` con `currentMartingale = 0` |
| `MG1` | `WON` con `currentMartingale = 1` |
| `MG2` | `WON` con `currentMartingale = 2` |
| `LOSS` | `OperationState.LOST` |

**`LOSS` no equivale a "columna de longitud ≥ 6".** Sobre el histórico hay 493 LOSS y solo 340 columnas P/B de longitud ≥ 6, porque un TIE parte la columna pero no parte la operación: una operación puede perder repartida entre dos columnas distintas. Por eso `resultado_final` se persiste y nunca se deriva de `columnas.longitud`.

### 1.5 `bloqueada_por_operacion_previa`

Analytics registra **la oportunidad pura**: toda columna P/B que alcanza longitud 3, con independencia de si el motor real habría podido operarla en ese instante.

El motor tiene un guard que impide dos operaciones simultáneas de la misma estrategia (`ActiveOperationRegistry.canExecute`), y una regla anti-duplicación que evita repetir señal sobre la misma corrida (`StreakStrategyBase` + `StrategyRuntimeState`). Esa restricción **no se pierde**: las oportunidades cuya confirmación cae mientras seguía abierta una operación anterior quedan marcadas con `bloqueada_por_operacion_previa = true`.

Sobre el histórico son **50 de 4.119 (1,2 %)**. Causa raíz verificada: un TIE dentro de una operación abre una columna nueva que alcanza longitud 3 **en la misma jugada** que resuelve la operación previa. Ejemplo mínimo: `P P P | T | P P P` — en la tercera P la primera operación llega a LOSS *y* nace una segunda oportunidad.

**El Core las excluye por defecto.** La API permite incluirlas explícitamente (`?incluir_bloqueadas=true`) para análisis histórico completo, y toda respuesta reporta cuántas quedaron fuera en `muestra_bloqueadas_excluidas`.

**Divergencia conocida, fuera de alcance por decisión:** el motor real, además de saltear esas 50, dispararía 19 señales con la corrida ya en longitud 4 en vez de 3 (porque evalúa la señal antes de cerrar la operación con esa misma jugada). Modelar ese disparo retrasado exigiría un segundo pase con estado y mueve 0,46 % de las filas; se documenta y no se implementa.

### 1.6 `integridad_ok`

`false` cuando hay una discontinuidad temporal (> umbral) dentro de la ventana `[jugada_inicio_id .. jugada_resolucion_id]`, o justo antes del inicio de la corrida. Significa que **faltan rondas reales** y que la fila es sospechosa: si la columna arranca después de un hueco, su "tercera jugada" puede no ser la tercera real de la corrida.

Sobre el histórico son **10 de 4.119 (0,24 %)**.

Criterio **distinto y deliberado** frente a las bloqueadas: las de integridad dudosa se **incluyen** por defecto, porque son observaciones reales de lo que sí quedó registrado y excluirlas sería descartar datos en silencio. Pero **toda respuesta trae `muestra_integridad_dudosa`**, así que su presencia nunca pasa inadvertida. Se pueden excluir con `?incluir_integridad_dudosa=false`.

---

## 2. Arquitectura y responsabilidades

```
Tipminer ──SSE──> Mk-Ingestion-Service ──INSERT por lotes──> jugadas   (fuente de verdad)
                                                                │
                        analytics_racha3_incremental()  <── tick 60 s ── Racha3IncrementalScheduler
                                                                │
                                                    columnas · racha3_operaciones
                                                    analytics_checkpoints · analytics_ejecuciones
                                                                │
                                            vw_racha3 + 12 funciones de agregación
                                                                │
                                   GET /api/v1/analytics/racha3/*  ──>  Core (decide)
```

| Componente | Responsabilidad | NO es responsable de |
|---|---|---|
| `Mk-Ingestion-Service` | Recibir, validar y persistir jugadas por lotes; garantizar idempotencia de inserción (`UNIQUE(uuid)` + `skipDuplicates`) | Estadísticas, predicciones, decisiones |
| PostgreSQL | Fuente de verdad, datos derivados, procesamiento incremental, agregaciones, reconstrucción | — |
| `Racha3IncrementalScheduler` | Disparar el incremental cada 60 s | Cualquier lógica analítica |
| `PrismaRacha3AnalyticsReader` | Invocar las funciones SQL y convertir tipos | Calcular una sola tasa |
| API `analytics/racha3` | Validar parámetros, proyectar al contrato JSON | Calcular estadística |
| **Core** | Analizar el contexto actual, combinar las ~200 jugadas en memoria con estas estadísticas, decidir alerta / no alerta | — |

**Toda la estadística vive en SQL.** Ni el reader, ni el read-model, ni el controller calculan una tasa, un promedio o un filtro adicional. La razón es concreta: la capa SQL se verifica contra una implementación de referencia independiente en TypeScript (§7), y cualquier cálculo que se filtrara fuera de SQL quedaría fuera del alcance de esa verificación.

### 2.1 Archivos

| Archivo | Rol |
|---|---|
| `src/core/analytics/racha3-reference.ts` | Reconstructor de **referencia** en TypeScript puro. No es producción: existe para validar el SQL. Conduce la clase `Operation` **real** del motor |
| `src/core/analytics/racha3-reference.spec.ts` | 30 fixtures con los casos manuales de §1 |
| `src/core/analytics/interfaces/racha3-processor.interface.ts` | Puerta de **escritura** (disparar el incremental) |
| `src/core/analytics/interfaces/racha3-analytics-reader.interface.ts` | Puerta de **lectura** (las 12 agregaciones) |
| `src/core/analytics/types/*.ts` | Tipos planos: nunca `BigInt` ni `Decimal` |
| `src/application/analytics/racha3-incremental.scheduler.ts` | Tick de 60 s y política de fallos |
| `src/application/analytics/racha3-analytics.read-model.ts` | Único punto por el que `api/` accede a Analytics |
| `src/application/analytics/analytics.module.ts` | Enlaza los dos tokens a sus implementaciones |
| `src/infrastructure/persistence/analytics/prisma-racha3.processor.ts` | Llama a `analytics_racha3_incremental()` |
| `src/infrastructure/persistence/analytics/prisma-racha3-analytics.reader.ts` | Llama a las funciones de agregación y convierte tipos |
| `src/api/resources/analytics/racha3-query.ts` | Validación estricta de query params |
| `src/api/resources/analytics/racha3-analytics.controller.ts` | Los 8 GET + 1 POST |
| `src/api/contracts/view-models/racha3-analytics.vm.ts` | Contrato JSON |
| `src/api/contracts/mappers/racha3-analytics.mapper.ts` | Proyección a los view models |
| `scripts/analytics-rebuild.ts` | `pnpm analytics:rebuild` |
| `scripts/analytics-verify.ts` | `pnpm analytics:verify` |

**Dos puertas separadas a propósito.** `Racha3Processor` es la única que escribe; `Racha3AnalyticsReader` solo lee. Partirlas hace que el tipo de cada consumidor declare qué puede hacer, en vez de dejarlo a la disciplina de quien lo use.

**El motor de alertas no se modificó.** `AnalyticsModule` no se suscribe al `DomainEventBus`, no conoce Strategy, Operation ni Notification, y ninguno de ellos lo conoce. Su único punto de contacto con el resto del sistema es la conexión a Postgres. Verificado en vivo: durante una prueba el `GameEventCollector` falló por DNS y el scheduler siguió procesando normalmente.

---

## 3. Modelo de datos

Cuatro tablas derivadas. **Todas se reconstruyen al 100 % desde `jugadas`**, que es la única fuente de verdad y nunca se modifica. Esquema completo y justificación de cada columna en `DATABASE.md` §11.

### 3.1 `columnas`

`id` · `tipo` · `longitud` · `inicio_jugada_id` (UNIQUE, FK) · `fin_jugada_id` (FK) · `inicio_en` · `fin_en` · `corte_por_gap` · `cerrada_por_gap`

- `inicio_jugada_id` UNIQUE es la **clave natural de idempotencia**.
- `corte_por_gap`: la columna empieza por un hueco, no por cambio de ganador → longitud posiblemente truncada por la izquierda.
- `cerrada_por_gap`: la siguiente empieza por hueco → longitud posiblemente truncada por la derecha. Es el dato que necesitará el futuro concepto **"L"** (columna P/B de longitud ≥ 6) para descartar longitudes no confiables sin volver a interpretar `jugadas`.
- **No hay columna `cerrada`**: sería estado redundante, porque la única columna extensible es siempre `max(id)`.
- Sin `CHECK` sobre `tipo`, mismo criterio que `jugadas.ganador`: un valor nuevo del proveedor nunca debe abortar un rebuild completo.

### 3.2 `racha3_operaciones`

Una fila por oportunidad, con su operación simulada en la misma fila (1:1 estricto con `columnas`).

Anclaje: `columna_id` (UNIQUE, FK) · `jugada_inicio_id` · `jugada_confirmacion_id` (UNIQUE) · `jugada_directa_id` · `jugada_mg1_id` · `jugada_mg2_id` · `jugada_resolucion_id` — **todas FK a `jugadas`**, nunca listas JSON de uuids. Los uuid originales se recuperan con un JOIN, sin duplicar el dato.

Estado y resultado: `estado` · `resultado_final` · `max_martingalas` (persistido por operación, porque en el motor es mutable en runtime vía API).

Derivados: `duracion_ms` · `jugadas_evaluadas` · `ties_en_operacion` · `jugadas_desde_anterior` · `columnas_desde_anterior` · `segundos_desde_anterior` · `hora_col_inicio` · `hora_col_confirmacion` · `hora_col_resolucion`.

Banderas: `bloqueada_por_operacion_previa` · `integridad_ok`.

**26 CHECK constraints** cubren la coherencia intra-fila (la escalera de martingala no puede saltarse niveles, `RESUELTA` implica resultado + instante + jugada de resolución, `apuesta <> tipo_racha`, horas en 0-23…). Lo que un CHECK no puede verificar — relaciones entre filas y contra `jugadas` — lo cubren las invariantes V0–V11 (§8).

### 3.3 `analytics_checkpoints`

Una fila por proceso (`'racha3'` es el único). Ausencia de fila = nunca se procesó, que es un estado legítimo.

- `ultima_jugada_id`: marca de agua. **Nunca extremo de un rango cerrado**: `jugadas.id` no es contiguo (579 valores consumidos sin fila, por el `ON CONFLICT DO NOTHING` del batcher de ingesta). Todo recorrido es `id > checkpoint ORDER BY id`; **`id BETWEEN a AND b` está prohibido en este dominio**.
- `ultima_jugada_en`: detecta inserciones retroactivas que romperían el orden por id.
- `reproceso_desde_jugada_id`: **punto de rebobinado seguro** — la menor entre el inicio de la última columna y el inicio de la columna de la operación `PENDIENTE` más antigua. Ambos son inicios de columna, así que el tramo siempre arranca en una frontera limpia.

### 3.4 `analytics_ejecuciones`

Bitácora: `tipo` (`REBUILD`/`INCREMENTAL`) · `estado` (`OK`/`ERROR`) · rango recorrido · contadores · `duracion_ms` · `error`.

Se inserta **una sola fila, al final**, con el estado definitivo. No hay estado `EN_CURSO`: plpgsql no tiene transacciones autónomas, así que una fila escrita al inicio desaparecería en el mismo ROLLBACK que se quiere registrar. Las funciones envuelven el trabajo en `BEGIN … EXCEPTION` (savepoint implícito), capturan el error y recién entonces insertan: el trabajo se revierte, la bitácora sobrevive.

Un crash duro (conexión cortada) no deja fila; la señal en ese caso es el checkpoint que no avanzó, visible en `GET /api/v1/analytics/racha3/estado`.

---

## 4. Timezone

**`America/Bogota` es la única zona horaria de toda la analítica temporal.** Nunca se suma ni se resta horas: siempre `AT TIME ZONE 'America/Bogota'` con el nombre de la zona. Colombia no aplica horario de verano (offset fijo −05:00), pero se usa el nombre igual, por si eso cambiara y para que el código diga qué significa.

`AT TIME ZONE` con nombre de zona es `STABLE`, **no `IMMUTABLE`**, así que PostgreSQL **prohíbe** usarlo en `GENERATED … STORED` o en un índice de expresión. Por eso `hora_col_inicio`, `hora_col_confirmacion` y `hora_col_resolucion` son **columnas normales** escritas por la función de procesamiento, no generadas. La invariante V10 las recalcula y exige 0 diferencias — es la única forma de detectar que alguien las escribió a mano o con aritmética de offsets.

Del lado TypeScript, `horaColombia()` usa `Intl.DateTimeFormat` con `timeZone: 'America/Bogota'` y `hourCycle: 'h23'`, de modo que el resultado no depende de la zona horaria de la máquina que corre el proceso.

Toda respuesta de la API que expone horas declara `zona_horaria: "America/Bogota"`.

---

## 5. Procesamiento

### 5.1 REBUILD (`analytics_racha3_rebuild`)

Reconstrucción histórica completa. Una sola transacción, bajo `pg_advisory_xact_lock(42, 3)`.

1. `TRUNCATE racha3_operaciones, columnas RESTART IDENTITY` — **`jugadas` nunca se toca**.
2. Columnas: *gaps-and-islands* con corte adicional por discontinuidad temporal.
3. Verificación de cobertura: las columnas insertadas deben cubrir exactamente las jugadas del tramo, o aborta.
4. Oportunidades: filtro positivo `tipo IN ('PLAYER','BANKER') AND longitud >= 3`; la 3.ª jugada confirma; `LATERAL` sobre las primeras (hasta) 3 jugadas P/B posteriores.
5. Derivados y banderas.
6. UPSERT del checkpoint.
7. Bitácora.

**Sin límite artificial de jugadas hacia adelante.** El `LIMIT 3` del SQL no es una ventana de búsqueda: es la cantidad exacta de puntos de decisión que tiene la martingala. Los TIEs intercalados son ilimitados y se cuentan por diferencia de ids.

**Rendimiento medido: ~2,8 s** para 42.400 jugadas → 25.400 columnas y 4.100 oportunidades.

### 5.2 INCREMENTAL (`analytics_racha3_incremental`)

Una sola transacción, mismo advisory lock.

1. Leer checkpoint. Sin checkpoint, aborta pidiendo un rebuild.
2. **Guardia de retroactividad**: si existe una jugada con `id` mayor pero `jugada_en` anterior a `ultima_jugada_en`, el orden por id dejó de ser cronológico y aborta exigiendo REBUILD.
3. Si no hay jugadas nuevas → **no-op absoluto**: no toca ni una fila y no reclama el checkpoint.
4. `DELETE FROM columnas WHERE inicio_jugada_id >= reproceso_desde_jugada_id` (el CASCADE se lleva sus oportunidades) y reconstruir el tramo entero.
5. Actualizar checkpoint y bitácora.

**DELETE + INSERT, no UPSERT** — decisión explícita, con la corrección y la simplicidad como prioridad declarada. Los ids de `columnas` y `racha3_operaciones` son **efímeros** y nadie fuera del dominio debe tratarlos como identidad; a cambio, un gap recién descubierto que parte una columna en dos se maneja sin ningún caso especial.

**Rendimiento medido:** 9 ms (4 jugadas) a 165 ms (1.597 jugadas). En régimen normal, con ~20 jugadas nuevas por tick: ~80 ms.

**Idempotencia verificada de tres formas:**
1. Tres incrementales seguidos sin jugadas nuevas → 0 filas modificadas, checkpoint intacto.
2. Un REBUILD ejecutado dos veces → contenido idéntico.
3. **REBUILD completo == REBUILD parcial + INCREMENTAL**, comprobado desde 6 puntos de resume distintos (4 a 1.597 jugadas de rezago), comparando huella md5 del contenido. Idéntica en los 6, invariantes verdes en los 6.

### 5.3 Scheduler de 60 s

`Racha3IncrementalScheduler` — un `setInterval`, configurable con `ANALYTICS_INTERVAL_MS` (default 60000). Mismo patrón que `ReportCheckpointScheduler`; el proyecto no usa `@nestjs/schedule` a propósito.

60 s alcanza porque Analytics es descriptivo sobre decenas de miles de jugadas: un rezago de unas pocas jugadas no cambia ninguna conclusión.

Garantías, todas cubiertas por pruebas:

| Garantía | Cómo |
|---|---|
| Nunca tumba el proceso | Ningún desenlace propaga excepción fuera de `runTick` |
| Un tick fallido no detiene el scheduler | El `setInterval` sigue vivo pase lo que pase |
| Sin solapamiento | Bandera `ejecutando` (dentro del proceso) + `pg_advisory_xact_lock(42,3)` (entre procesos) |
| Silencio cuando no pasa nada | Un tick sin jugadas nuevas solo deja rastro en `debug` |
| Tolerancia a cortes del pooler | `warn` los primeros 4 fallos; escala a `error` al 5.º y **una sola vez** |
| Fallo de dominio ≠ fallo de red | Un `ERROR_PROCESO` se grita de inmediato y va al `EngineErrorTracker`; un corte de red se susurra |
| Persistencia deshabilitada | Un solo `warn`, no uno por tick. No es un incidente del motor |
| Shutdown limpio | `clearInterval` en `onModuleDestroy`, idempotente |

Verificado en vivo contra la base real, con un fallo de conexión genuino (puerto sin listener): arranque → tick productivo → 5 caídas → escalada → recuperación → régimen → apagado. **El checkpoint no se corrompió y las invariantes se mantuvieron verdes durante toda la caída** — la función SQL corre en una única transacción, así que un corte revierte todo su trabajo.

---

## 6. Objetos SQL

**1 vista + 17 funciones.** Todas de solo lectura excepto `reconstruir`, `rebuild` e `incremental`.

| Objeto | Qué hace |
|---|---|
| `vw_racha3` | Proyección plana de una oportunidad con su columna. Base de todas las agregaciones y superficie para consultas ad-hoc. No filtra nada |
| `analytics_racha3_reconstruir(p_desde, p_umbral_ms, p_max_martingalas)` | **Núcleo compartido** por rebuild e incremental. No borra nada ni toca el checkpoint |
| `analytics_racha3_rebuild(p_umbral_ms, p_max_martingalas)` | TRUNCATE + reconstruir todo |
| `analytics_racha3_incremental(p_umbral_ms, p_max_martingalas)` | DELETE del tramo rebobinado + reconstruir |
| `analytics_racha3_rebobinado()` | Punto de rebobinado seguro |
| `analytics_racha3_validar(p_umbral_ms)` | Invariantes V0–V11, sin efectos |
| `racha3_bucket_indice(p_valor, p_cotas)` | Índice de bucket para un valor |
| `racha3_bucket_etiqueta(p_indice, p_cotas)` | Etiqueta legible (`"6-10"`, `"51+"`) |
| `racha3_resumen(...)` | Frecuencia + resultado de operaciones (1 fila) |
| `racha3_por_hora(...)` | Análisis temporal, siempre 24 filas |
| `racha3_por_dia(...)` | Frecuencia por día calendario de Bogotá |
| `racha3_serie_distancias(p_entre, ...)` | Núcleo de intervalos y hazard: distancia de cada oportunidad a la anterior, en 3 unidades |
| `racha3_intervalos(p_entre, ...)` | Estadísticos (min/p25/mediana/p75/p90/p99/max/promedio/desviación), 3 filas |
| `racha3_distribucion(p_metrica, p_cotas, p_entre, ...)` | Distribución por buckets (**frecuencia histórica**) |
| `racha3_hazard_distancia(p_cotas, ...)` | **Tasa empírica condicionada** por distancia |
| `racha3_columnas_distribucion(p_tipo, p_maximo)` | Longitudes de columna por tipo. Base del futuro "L" |
| `racha3_distancia_actual(p_incluir_bloqueadas)` | Jugadas desde la última Racha 3, con su propio margen de error |
| `racha3_estado()` | Salud del pipeline derivado |

### 6.1 Buckets configurables

Las cotas llegan como `integer[]` en cada llamada, **no** como tabla de configuración: cambiar los buckets no requiere migración ni redespliegue.

`'{5,10,15,20,30,50}'` (el default acordado) produce `0-5 / 6-10 / 11-15 / 16-20 / 21-30 / 31-50 / 51+`. `'{3,7,20}'` produce `0-3 / 4-7 / 8-20 / 21+`.

Se devuelven **todos** los buckets, incluso los vacíos: un bucket ausente se confunde con "no consultado", uno con `n = 0` dice lo que realmente pasa.

### 6.2 Filtros comunes

`p_desde` / `p_hasta` (ventana semiabierta `[desde, hasta)` sobre `confirmacion_en`) · `p_tipo` · `p_incluir_bloqueadas` (**default `false`**) · `p_incluir_integridad_dudosa` (**default `true`**) · `p_umbral_muestra` (default 100).

**Las distancias se recalculan sobre el subconjunto filtrado**, nunca se leen de `racha3_operaciones.jugadas_desde_anterior`, que está calculada sobre TODAS las filas. Usar el valor almacenado tras filtrar daría distancias que no corresponden a la serie consultada.

### 6.3 Unidades

**Todas las proporciones son fracciones en `[0,1]`, `numeric(6,4)`, nunca porcentajes.** Mezclar fracciones y porcentajes en un mismo conjunto de resultados es una fuente clásica de errores por factor 100. Junto a cada proporción va siempre su conteo crudo, para que el consumidor pueda recomputarla.

### 6.4 Rendimiento medido (`EXPLAIN ANALYZE, BUFFERS`)

| Función | Tiempo | Buffers |
|---|---|---|
| `racha3_resumen()` | 14 ms | 8.646 |
| `racha3_por_dia()` | 15 ms | 8.337 |
| `racha3_por_hora()` | 27 ms | 12.394 |
| `racha3_columnas_distribucion()` | 40 ms | 284 |
| `racha3_intervalos()` | 63 ms | 29.302 |
| `racha3_hazard_distancia()` | 121 ms | 29.310 |
| `racha3_distribucion()` | 126 ms | 29.302 |

Todas por debajo del umbral acordado de 200 ms, con `Shared Read Blocks = 0` (los datos están íntegramente en caché).

**Nada está materializado, y es deliberado.** Con ~4.100 filas cualquier agregación se resuelve en milisegundos, y una tabla derivada de una tabla derivada solo agregaría un segundo problema de consistencia. Umbral acordado para reconsiderarlo: **~500k filas o p95 > 200 ms** en un endpoint real (≈5 años al ritmo de ~250 oportunidades/día).

**Dos trampas de rendimiento ya resueltas — no reintroducirlas:**

1. Un CTE `gaps` sin `MATERIALIZED` se inlina dentro del `EXISTS` correlacionado y reevalúa la ventana sobre las 42k jugadas **una vez por operación**.
2. Un límite superior escrito como `(x IS NULL OR j.id <= x)` impide usar el índice como rango y escanea todas las jugadas posteriores por cada fila (~42k × 4.100 = 172M filas). Hay que acotar siempre con `COALESCE(x, v_max_id)`.

Cualquiera de las dos hace que el REBUILD supere el `statement_timeout` de 2 min de Supabase.

**Y una "optimización" descartada por medición**: las distancias se calculan con subconsultas correlacionadas y **no** con `row_number()`. La versión con ordinales lee menos de la mitad de buffers (12.689 contra 29.302) y aun así es consistentemente **más lenta** (`racha3_distribucion` 163 ms contra 126 ms), porque el índice de `jugadas` entra entero en caché y ordenar 42k filas cuesta más que 4.100 recorridos de rango. Podría invertirse si `jugadas` deja de caber en memoria: hay que **volver a medir**, no razonarlo.

---

## 7. Verificación TS ↔ SQL

```bash
pnpm analytics:verify
```

**Criterio de aceptación: 0 diferencias y todas las invariantes en verde.**

El script reconstruye el histórico completo con `src/core/analytics/racha3-reference.ts` (TypeScript puro) y lo compara **campo a campo** con lo que dejaron en la base las funciones plpgsql: las 8 columnas de `columnas` y las 26 de `racha3_operaciones`, más el ancla hacia la columna por su clave natural. Después ejecuta V0–V11 y 12 comprobaciones de la capa de agregación.

Dos implementaciones independientes que llegan al mismo resultado es evidencia mucho más fuerte que una sola verificada contra sí misma.

**La parte crítica no está duplicada, a propósito**: la máquina de estados de la operación (martingalas, TIE neutral, victoria/derrota) **no** se reimplementa en la referencia — se conduce la clase `Operation` **real** del motor. Si alguien cambia la regla de martingala o la neutralidad del TIE, la referencia cambia con ella y la comparación contra el SQL falla en CI. Esa es exactamente la señal que se quiere: Analytics y el motor no pueden divergir en silencio.

Lo que sí está reimplementado (columnas, cortes por gap, derivados) es lógica que el motor no tiene, porque solo mira las últimas 200 jugadas en memoria y nunca construyó el concepto de columna.

**La comparación se acota al checkpoint.** La ingesta sigue insertando mientras el script corre; reconstruir desde todas las jugadas vivas y compararlo contra tablas derivadas que llegan hasta el último incremental produciría diferencias que no son defectos, solo rezago. El script informa cuántas jugadas quedan fuera.

**Divergencia real que encontró esta verificación** (y que ninguna prueba unitaria habría detectado): 2.086 diferencias en un solo campo, `segundos_desde_anterior`, siempre 1 más en SQL. Causa: `EXTRACT(epoch …)::integer` **redondea** en PostgreSQL y `Math.trunc` **trunca**; con precisión de milisegundos, 723,6 s → 724 vs 723. **Semántica fijada: truncamiento** ("segundos completos transcurridos"), en ambos lados; la precisión exacta vive en `duracion_ms` y en los propios `timestamptz`.

### 7.1 Fixtures

`src/core/analytics/racha3-reference.spec.ts` — 30 casos, con los ejemplos textuales de §1 más los bordes: gap que corta una columna, gap por debajo del umbral, oportunidad bloqueada, integridad inválida por hueco dentro y fuera de la ventana de la operación, escalera que salta TIEs, cruce de día en hora Colombia, ausencia de DST.

Notación: `P`/`B`/`T` y `|` para un hueco mayor al umbral. Los ids de las jugadas sintéticas **saltan de a 2 a propósito**, porque `jugadas.id` no es contiguo en la base real y nada del código puede depender de que lo sea.

---

## 8. Invariantes V0–V11

`SELECT * FROM analytics_racha3_validar();` — sin efectos secundarios, una fila por invariante con `ok`, `fallos` y un ejemplo.

Comprueban lo que un `CHECK` no puede: relaciones entre filas, entre tablas y contra los datos reales de `jugadas`.

| # | Invariante |
|---|---|
| **V0** | `jugadas.ganador` solo contiene `PLAYER`/`BANKER`/`TIE`. Si el proveedor introduce un valor nuevo, el filtro positivo lo ignora en silencio: algo tiene que gritarlo |
| **V1** | `sum(columnas.longitud) = count(jugadas)` |
| **V2** | Columnas contiguas, sin solapes ni huecos, y la longitud declarada es la real |
| **V3** | Dos columnas adyacentes del mismo tipo **solo** con `corte_por_gap` |
| **V4** | `cerrada_por_gap` = `corte_por_gap` de la siguiente |
| **V5** | `columnas.tipo` = ganador real de todas sus jugadas, sin gaps internos |
| **V6** | Exactamente una Racha 3 por columna P/B de longitud ≥ 3, y ninguna por columna no elegible |
| **V7** | `inicio`/`confirmacion`/`tipo`/`apuesta` anclados correctamente a la columna |
| **V8** | La escalera son las primeras N jugadas P/B posteriores a la confirmación |
| **V9** | `resultado_final` coherente con los ganadores **reales** de la escalera |
| **V10** | `hora_col_*` derivadas de los `timestamptz` con `AT TIME ZONE 'America/Bogota'` |
| **V11** | Todos los derivados (distancias, evaluadas, ties, duración, bloqueada, integridad) son recomputables e iguales |

**Todas se evalúan acotadas al checkpoint**, no contra todas las jugadas. Corregido en `20260908030000_analytics_racha3_validar_corte`: con la ingesta corriendo, V1, V8 y V11 reportaban como violación lo que solo era rezago del incremental. No se había detectado antes porque el validador siempre se corría inmediatamente después de un rebuild, cuando checkpoint y `max(id)` coinciden.

---

## 9. API

Contrato completo de los 8 GET + 1 POST en `documentacion_mk_api.md` §4.13. Decisiones de diseño en `Mk-Api.md` ADR-13.

Resumen: `/resumen` · `/intervalos` · `/por-hora` · `/por-dia` · `/distancia-actual` · `/perdidas` · `/columnas/distribucion` · `/estado` · `POST /reprocesar`, todos bajo `/api/v1/analytics/racha3/` con `X-Api-Key`.

**Sin N+1**: máximo 2 consultas SQL por petición, verificado con `pg_stat_statements`.

---

## 10. Procedimiento operativo

### 10.1 Rebuild histórico completo

```bash
pnpm analytics:rebuild        # ANALYTICS_GAP_MS opcional, default 120000
pnpm analytics:verify         # obligatorio después: 0 diferencias + V0..V11 verdes
```

Hace falta cuando cambia la lógica de reconstrucción, cuando cambia el umbral de gap, o cuando el incremental aborta por detectar una inserción retroactiva. Todo ocurre en una única transacción: o queda completo y el checkpoint avanza, o no queda nada.

**No se expone por HTTP**, a propósito: es destructivo (`TRUNCATE`) y dura segundos.

### 10.2 Reprocesamiento a pedido

```bash
curl -X POST -H "x-api-key: $API_KEY" \
  http://localhost:3000/api/v1/analytics/racha3/reprocesar
```

Dispara solo el **incremental**. La exclusión mutua no depende de coordinarlo con el scheduler: el advisory lock los serializa y el segundo encuentra el trabajo ya hecho.

### 10.3 Diagnóstico

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/v1/analytics/racha3/estado
```

`al_dia: false` con `jugadas_sin_procesar` creciendo significa que el procesamiento está detenido, no que no haya Racha 3 nuevas. Sin este dato, ambas cosas se ven igual desde afuera.

```sql
-- últimas corridas y cómo terminaron
SELECT tipo, estado, jugadas_leidas, columnas_afectadas, operaciones_afectadas,
       duracion_ms, error, iniciado_en
  FROM analytics_ejecuciones WHERE proceso = 'racha3'
 ORDER BY iniciado_en DESC LIMIT 10;

-- invariantes
SELECT * FROM analytics_racha3_validar();
```

---

## 11. Limitaciones y deuda conocida

### 11.1 Gaps históricos: datos que faltan y no se recuperan

19 discontinuidades > 120 s, una de **3,3 h** con ~361 rondas perdidas de forma **irrecuperable** (excede la ventana de 200 rondas de Tipminer). Efecto acotado y explícito: **10 de 4.119 oportunidades** con `integridad_ok = false`, y **37 columnas** marcadas como truncadas.

No se ocultan ni se borran. Se marcan, se cuentan en cada respuesta, y el consumidor decide.

### 11.2 `PrismaService` no reintenta la conexión — riesgo operativo abierto

`PrismaService` conecta **una sola vez** en `onModuleInit` y, si falla, queda deshabilitado para **toda la vida del proceso**. Verificado en vivo: un corte del pooler justo en el arranque dejó los 8 endpoints en 503 y los checkpoints de reporte sin guardar, hasta reiniciar.

No es hipotético: se observaron ~8 cortes esporádicos del pooler (`P1001`) en una sola sesión de trabajo.

**Queda como riesgo operativo separado, sin resolver dentro de Analytics**: afecta también a Reporting y potencialmente al motor, así que no debe improvisarse desde acá.

Medición relacionada: el **RTT de un `select 1` es ~324 ms por la conexión pooled** (`DATABASE_URL`, pgbouncer 6543) contra **~66 ms por la directa** (`DIRECT_URL`, 5432) — 5× de forma sistemática. La app usa la pooled en runtime, así que paga eso en cada consulta y domina la latencia de todos los endpoints. **Cambiarlo requiere análisis específico** de límites de conexión y pooling en Supabase; no se toca.

### 11.3 `/intervalos` — deuda técnica aceptada

Es el endpoint más lento: **~910 ms**. Causa medida: sus dos consultas recomputan cada una `racha3_serie_distancias` (4.100 subconsultas correlacionadas) y **compiten por CPU** en la instancia — 447 ms secuenciales contra **738 ms en paralelo**. El `Promise.all` es ahí contraproducente.

**No se parchea serializando**: eso rompería `/perdidas`, donde paralelizar sí gana 283 ms porque la serie de pérdidas tiene 492 filas en vez de 4.100. Si se optimiza, debe hacerse **en SQL**, con una función que devuelva estadísticos y distribución en una sola pasada. Decisión pendiente.

### 11.4 Sin histórico de alertas reales de `streak-3`

`StrategyChannelRegistry.channelByStrategy` es un `Map` en memoria que arranca **vacío** y no se persiste: `streak-3` queda sin canal en cada arranque y solo se asigna en runtime vía `PATCH /api/v1/channels/:channel`, perdiéndose al reiniciar. La estrategia oficial es `streak-4`.

Consecuencia: **no existe un histórico de alertas reales de `streak-3` contra el cual contrastar Analytics**. La validación es TS-referencia ↔ SQL, y la comparación contra producción queda oficialmente fuera de alcance hasta que exista persistencia de la configuración de canales.

Corolario positivo: `maxMartingalesOverrides` también arranca vacío, así que `max_martingalas = 2` es correcto para todo el histórico, y la columna existe como protección hacia adelante.

### 11.5 Otras

- **El orden por `id` es cronológico pero empíricamente**, no estructuralmente: depende de que `Mk-Ingestion-Service` sea el único escritor (verificado por grep: `Mk-Backend` no escribe en `jugadas`). Si alguna vez corren dos procesos contra la misma base, se rompe. La guardia de retroactividad del incremental lo detecta y exige rebuild.
- **`bloqueada_por_operacion_previa` no modela el disparo retrasado** del motor (19 filas, 0,46 %). Ver §1.5.
- **Ninguna migración aplicada debe editarse.** Cualquier corrección va en una migración nueva.

---

## 12. Números de referencia

Corte con 42.464 jugadas (2026-08-21 a 2026-09-08). Los conteos crecen con la ingesta; las métricas estructurales dependen de huecos históricos ya ocurridos y no se mueven.

| Métrica | Valor |
|---|---|
| Columnas | 25.417 |
| Con `corte_por_gap` | **19** (estructural) |
| Adyacentes del mismo tipo | **8** (estructural) |
| Columnas P/B ≥ 6 ("L") | 340 |
| Oportunidades Racha 3 | 4.119 |
| `DIRECTA` / `MG1` / `MG2` / `LOSS` | 2.069 / 1.022 / 528 / 493 |
| `bloqueada_por_operacion_previa` | **50** (estructural) |
| `integridad_ok = false` | **10** (estructural) |
| Máx. jugadas evaluadas / TIEs en una operación | 7 / 4 |

Tasas sobre las resueltas (excluyendo bloqueadas, el default del Core): `tasa_directa` 0,5017 · `tasa_mg1` 0,2485 · `tasa_mg2` 0,1284 · `tasa_perdida` 0,1199 · `tasa_acierto_total` 0,8801.

Por tipo: PLAYER `tasa_directa` 0,5219 y `tasa_perdida` 0,1066; BANKER 0,4848 y 0,1329.

Intervalos entre Racha 3 (n=4.061): jugadas mediana **8** (p90 20, max 74) · columnas mediana **5** · segundos mediana **290**.

Tasa empírica condicionada por distancia:

| bucket | casos_observados | eventos | tasa_empirica_condicionada | frecuencia_historica |
|---|---|---|---|---|
| 0-5 | 19.314 | 1.034 | 0,0535 | 0,2546 |
| 6-10 | 11.701 | 1.551 | 0,1326 | 0,3819 |
| 11-15 | 5.645 | 744 | 0,1318 | 0,1832 |
| 16-20 | 2.846 | 354 | 0,1244 | 0,0872 |
| 21-30 | 2.169 | 281 | 0,1296 | 0,0692 |
| 31-50 | 732 | 89 | 0,1216 | 0,0219 |
| 51+ | 74 | 8 | 0,1081 | 0,0020 |

**Observación descriptiva, no señal predictiva:** la tasa condicionada es prácticamente **plana (~0,12–0,13) a partir de la jugada 6**, y notoriamente menor en `0-5`. La caída inicial tiene explicación mecánica — formar una corrida nueva exige al menos 3 jugadas. Que sea plana después significa que, en este histórico, **la distancia acumulada no informa** sobre la aparición de la siguiente Racha 3. Qué hacer con eso es decisión del Core.

Nótese también que frecuencia y tasa condicionada **ordenan los buckets al revés**. Es la confusión que toda la disciplina de nombres de §0 existe para prevenir.

---

## 13. Documentos relacionados

- `DATABASE.md` §11 — esquema real de las cuatro tablas derivadas, columna por columna.
- `documentacion_mk_api.md` §4.13 — contrato de los 9 endpoints.
- `Mk-Api.md` ADR-13 — decisiones de diseño de la capa de API de Analytics.
- `ARCHITECTURE.md` — capas y flujo del motor de alertas (Analytics no participa de ese flujo).
- `CLAUDE.md` — comandos y convenciones del repo.

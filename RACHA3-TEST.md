# Racha 3 Test — estrategia experimental

> **Esta estrategia no apuesta.** No crea `Operation`, no aparece en el token
> `STRATEGIES`, no publica eventos de dominio y no envía nada a los canales de
> producción. Solo lee, evalúa, simula y manda mensajes de DEBUG a un canal de
> Telegram propio. Arranca apagada.

Duplicación controlada de la estrategia de producción `streak-3`: conserva su
lógica de detección **reutilizando la instancia real**, y le añade encima la
evidencia histórica del dominio Analytics (ver [`ANALYTICS.md`](./ANALYTICS.md))
para calcular un `score` y decidir si la oportunidad se tomaría o se
descartaría.

Índice:

1. [Qué problema resuelve](#1-qué-problema-resuelve)
2. [Arquitectura y por qué no es una `Strategy`](#2-arquitectura-y-por-qué-no-es-una-strategy)
3. [Aislamiento respecto de `streak-3`](#3-aislamiento-respecto-de-streak-3)
4. [El score: qué se midió antes de elegir la fórmula](#4-el-score-qué-se-midió-antes-de-elegir-la-fórmula)
5. [Fórmula exacta](#5-fórmula-exacta)
6. [Gates](#6-gates)
7. [Parámetros y configuración](#7-parámetros-y-configuración)
8. [Simulación de operaciones virtuales](#8-simulación-de-operaciones-virtuales)
9. [Mensajes DEBUG](#9-mensajes-debug)
10. [Observabilidad: logs estructurados](#10-observabilidad-logs-estructurados)
11. [Backtest: retrospectivo vs walk-forward](#11-backtest-retrospectivo-vs-walk-forward)
12. [Comportamiento ante fallos](#12-comportamiento-ante-fallos)
13. [Archivos, tests y comandos](#13-archivos-tests-y-comandos)
14. [Limitaciones conocidas](#14-limitaciones-conocidas)

---

## 1. Qué problema resuelve

`streak-3` emite una alerta cada vez que detecta tres resultados consecutivos
iguales, sin mirar el histórico. Sobre las 4.069 oportunidades resueltas y no
bloqueadas del histórico al 2026-09-08, esa regla acierta el **87,91 %**
(directa + mg1 + mg2), con IC95 de Wilson `[86,87 – 88,87]`.

La pregunta del experimento es concreta: **¿hay algo observable en el instante
de la confirmación que permita separar las oportunidades buenas de las malas?**

No se asumió que la respuesta fuera sí. Se midió primero (§4).

---

## 2. Arquitectura y por qué no es una `Strategy`

```
GameReceivedEvent (bus real, síncrono)
   │
   ├─► StrategyCoordinator ──► Streak3Strategy ──► StrategyTriggeredEvent ──► Operation REAL
   │                                                                          (producción, intacto)
   │
   └─► Racha3TestCoordinator
          │  1. detectar()          reutiliza la INSTANCIA real de Streak3Strategy
          │                         con runtimeState / execution / config PROPIOS
          │  2. actualizarSimulacion()
          │  3. reservar() + void evaluar()   ← asíncrono
          │
          ├─► Racha3TestEvidenceProvider ──► Racha3AnalyticsReadModel ──► funciones SQL de Analytics
          ├─► calcularRacha3TestScore()   (core puro, determinístico)
          ├─► Racha3TestSimulationRegistry ──► Racha3TestSimulacion ──► Operation (VIRTUAL)
          └─► Racha3TestDebugNotifier ──► TelegramChannel DEBUG (fuera de NOTIFICATION_CHANNELS)
```

Dos razones **independientes y las dos bloqueantes** por las que no se registró
como una `Strategy` más:

1. **`Strategy.evaluate()` es síncrono** y `DomainEventBus.publish()` también.
   No hay forma de esperar una consulta a PostgreSQL dentro de `evaluate()`, y
   esta estrategia necesita evidencia de Analytics antes de decidir.
2. **`OperationCoordinator.onStrategyTriggered()` crea una `Operation` para
   cualquier `StrategyTriggeredEvent`**, sin filtrar por estrategia. Registrar
   `racha-3-test` en `STRATEGIES` habría creado operaciones **reales** —
   exactamente lo que este experimento no debe hacer.

Por eso `Racha3TestCoordinator` se suscribe por su cuenta a
`GameReceivedEvent`, igual que hacen `StrategyCoordinator` y
`OperationCoordinator`, y **nunca publica `StrategyTriggeredEvent`**.

El orden dentro de `onGameReceived` replica al motor real: **primero** se
evalúa la señal, **después** se actualizan las simulaciones con la misma
jugada. Invertirlo cambiaría qué oportunidades se consideran bloqueadas (la
jugada que cierra una operación todavía ve el hueco ocupado).

---

## 3. Aislamiento respecto de `streak-3`

La detección **reutiliza la instancia real** de `Streak3Strategy` obtenida del
token `STRATEGIES`. Es deliberado: si mañana alguien cambia cómo se detecta una
racha, el experimento cambia con ella en vez de quedar describiendo un motor
que ya no existe. Lo que **no** se comparte es el contexto:

| Pieza del `StrategyContext` | Producción | Racha 3 Test | Por qué |
|---|---|---|---|
| `runtimeState` | singleton `InMemoryStrategyRuntimeState` | **instancia propia** | `StreakStrategyBase` guarda su anti-duplicación bajo la clave `'streak-3'`. Compartir el singleton habría hecho que el experimento **pisara el estado de la estrategia real y le robara señales**. Es el punto más delicado del diseño. |
| `execution` | `ActiveOperationRegistry` | `Racha3TestSimulationRegistry` | El guard del experimento se apoya solo en su simulación virtual. Compartir el registro real habría hecho que una simulación **bloqueara una alerta de producción**. |
| `config` | `StrategyChannelRegistry` (mutable vía `PATCH /api/v1/channels/:channel`) | `maxMartingales` fijo en 2 | Un override en runtime sobre la estrategia real no debe perturbar el experimento. Cero estado mutable compartido. |
| `historySnapshot` | compartido | compartido | Y no puede ser de otra forma: es el historial del juego. Es un snapshot inmutable, de solo lectura. |

Además:

- **El canal DEBUG está fuera de `NOTIFICATION_CHANNELS`.** Si estuviera ahí,
  `NotificationCoordinator.dispatchToAll()` le enviaría también las alertas
  reales de `streak-3`/`streak-4`.
- **`Racha3TestDebugNotifier` no usa `NotificationChannelDispatcher`.** Ese
  dispatcher publica `NotificationSentEvent`/`NotificationFailedEvent`, y
  `EngineMetricsService` los cuenta: cada mensaje DEBUG habría inflado la
  métrica `notificationsSent` que expone `/healthz` y
  `GET /api/v1/health`. Se llama `canal.send()` directo y no se publica ningún
  evento de dominio.
- **`enabledWhen` del canal DEBUG depende solo de `RACHA3_TEST_ENABLED`**, nunca
  de `StrategyChannelRegistry`. Atarlo a eso habría hecho que activar el
  experimento expulsara a la estrategia asignada al canal de pruebas
  («un canal, como máximo una estrategia»).

### Demostración

**Por diff** — el trabajo de F9 sobre archivos ya existentes es
**87 inserciones, 0 eliminaciones**:

```
$ git diff --stat HEAD -- src/ .env.example
.env.example                                     | 27 +++++++++++++++
src/app.module.ts                                |  8 +++++
src/core/constants/injection-tokens.constants.ts |  1 +
src/core/enums/notification-channel-type.enum.ts |  8 +++++
src/infrastructure/config/configuration.ts       | 43 ++++++++++++++++++++++++
5 files changed, 87 insertions(+)
```

Cero cambios en `core/strategy/`, `core/operation/`, `application/strategy/`,
`application/operation/`, `application/notification/` y
`infrastructure/telegram/`.

**Por tests** — en `racha3-test.coordinator.spec.ts` y
`racha3-test.module.spec.ts`:

| Propiedad | Test |
|---|---|
| No publica `StrategyTriggeredEvent` | `NO publica StrategyTriggeredEvent: OperationCoordinator nunca ve una señal suya` |
| No publica **ningún** evento de dominio | `no publica NINGÚN evento de dominio` |
| No comparte estado mutable | `usa un runtimeState PROPIO: no pisa el estado de la estrategia real` |
| Su guard no toca el registro real | `su guard no consulta el registro de operaciones reales` |
| Su config no es mutable desde la API | `su maxMartingales es fijo en 2 y no lee configuración mutable` |
| `streak-3` sigue detectando igual | `la estrategia real sigue detectando igual con su propio estado` |
| No recibe ni emite a producción | `el canal DEBUG NO está en NOTIFICATION_CHANNELS` |
| No crea operaciones reales | `` `racha-3-test` NO está registrada en STRATEGIES `` |

---

## 4. El score: qué se midió antes de elegir la fórmula

El requisito era explícito: **el score no puede ser arbitrario**. Antes de
escribir la fórmula se midió, sobre las 4.069 oportunidades resueltas del
histórico, la capacidad de cada rasgo **observable en el instante de la
confirmación** para discriminar el resultado.

Rasgos candidatos y resultado de la medición:

| Rasgo | ¿Discrimina el resultado? | Evidencia |
|---|---|---|
| `tipo_racha` (PLAYER / BANKER) | **Sí, y apenas** | 89,25 % vs 86,59 % → **2,67 pp**, z = 2,61 |
| `hora_col_confirmacion` (0-23) | No | plano; ninguna hora se separa del global al 95 % tras corregir por comparaciones múltiples |
| bloques de hora (madrugada / mañana / tarde / noche) | No | plano |
| `jugadas_desde_anterior` (distancia) | No | plano en todos los buckets |
| día de la semana | No | plano |
| resultado de la oportunidad anterior | No | plano |

**Conclusión: de seis rasgos observables, solo uno supera el ruido, y está al
borde de lo detectable.** Con 2,67 pp de diferencia y las tasas observadas,
distinguirlo con potencia 80 % exigiría ≈ 2.354 oportunidades por grupo; hay
≈ 2.035. Es decir: la señal es real *en este histórico* pero el histórico
todavía no es lo bastante grande para considerarla establecida.

Por eso:

- **`tipo_racha` es el único rasgo que entra al score.**
- Hora, día, distancia, hazard y `frecuencia_historica` viajan al DEBUG como
  **`contexto` con peso 0 explícito**. Se muestran para poder revisar después si
  alguno empieza a mostrar estructura, no porque hoy aporten. Darles peso sería
  fabricar señal.
- **No hay penalizaciones numéricas.** Ninguna de las degradaciones candidatas
  (rezago de Analytics, integridad dudosa, muestra chica) tiene una magnitud
  justificable por los datos. Inventar «−5 puntos por X» sería exactamente el
  peso artificial que este diseño evita. Todas están modeladas como **gate**
  (bloquean) o como **advertencia** (informan). `penalizaciones` existe en el
  tipo y hoy siempre viene vacío.

### Lo que resultó ser `tipo_racha`, en realidad

> **Ampliado el 2026-09-09.** `tipo_racha` sí discrimina, pero no porque las
> rachas de PLAYER sean especiales. Al medir el juego apareció el mecanismo:
>
> ```
> BANKER  50,530 %      PLAYER  49,470 %      (38.963 jugadas no-empate)
> z contra 50 % = 2,09  ·  homogéneo entre tercios (χ² = 0,28, crítico 5,99)
> ```
>
> Tras una racha de PLAYER se apuesta BANKER — el lado que gana un poco más.
> Tras una racha de BANKER se apuesta PLAYER — el que gana un poco menos. No
> es la racha: es **qué lado te deja apostando**. Por eso la variable del
> score es el **lado apostado**, no el tipo de racha (§5.2).
>
> Y el proceso **no tiene memoria**, medido de tres formas independientes:
> `P(la columna sigue | llegó a k)` es plana en ~0,44 para k=1..6; los
> intervalos entre pérdidas son geométricos (χ² = 3,70, crítico 9,49); y
> «oportunidades desde la última pérdida» es plano (todos los |z| < 0,5).
> Eso descarta de raíz cualquier score basado en «cada cuánto sale» o «no
> estar en rango de una L»: es la falacia del jugador, y los datos la
> rechazan.
>
> La medición completa —41 comparaciones con corrección de Bonferroni, de
> las que no sobrevive ninguna— está en el comentario de
> `racha3-test-score.calculator.ts`.

### Terminología

Se respeta la de `ANALYTICS.md`. Tres nombres que se parecen y no son lo mismo:

| Nombre | Qué es | ¿Alimenta el score? |
|---|---|---|
| `tasa_acierto_condicionada` | aciertos / resueltas para la condición | **Sí** |
| `tasa_empirica_condicionada` | *hazard* del bucket de distancia: «¿cuándo aparece la próxima Racha 3?» | No, peso 0 |
| `frecuencia_historica` | frecuencia de ocurrencia del bucket | No, peso 0 |

El score **no** es una `probabilidad`, una `predicción` ni una `confianza`. Es
el límite inferior de un intervalo de confianza sobre una tasa histórica: dice
«la tasa defendible de esta condición, dada la muestra que hay». Nada sobre la
próxima jugada.

---

## 5. Fórmula exacta

> **Rediseñada el 2026-09-09.** La versión original comparaba el límite
> inferior del IC95 de un subgrupo contra el del histórico GLOBAL (86,87).
> Eso es incoherente — el subgrupo es parte del grupo, así que se compara el
> dato contra sí mismo — y con exactamente dos categorías degenera en
> tautología: una está siempre por encima del promedio y la otra siempre por
> debajo, **por aritmética, no por evidencia**. El filtro no filtraba: tomaba
> siempre un lado y rechazaba siempre el otro. Y peor, un umbral así **nunca
> puede decir «no tomes nada»**.

### 5.1 El umbral: punto de equilibrio

El umbral responde a una pregunta que **no tiene nada que ver con cuántas
veces se ganó**: *¿qué tasa de acierto necesito para que esta apuesta no
pierda dinero?* Depende sólo de la estructura de pago.

```
gana  → +1 unidad, en cualquier nivel de la escalera
falla → −(1+2+4) = −7 unidades
TIE   → devuelve el 90 %, o sea CUESTA el 10 % de lo apostado en ese nivel.
        No consume gale y no cierra la operación, pero cobra peaje.

EV = p·ganancia − (1−p)·pérdida − peaje = 0
⟹  umbral = (pérdida + peaje) / (pérdida + ganancia)
umbral efectivo = max(RACHA3_TEST_UMBRAL_MINIMO, punto de equilibrio)
```

El peaje se **mide**, con `racha3_ties_por_nivel()` sobre el lado que se va a
apostar — una apuesta a PLAYER llega más veces a los niveles altos, y ahí un
empate cuesta el doble o el cuádruple:

| nivel | apuesta | empates | coste | por operación |
|---|---|---|---|---|
| 0 | 1 | 269 | 26,90 | 0,01284 |
| 1 | 2 | 126 | 25,20 | 0,01203 |
| 2 | 4 | 57 | 22,80 | 0,01088 |
| **total** | | **452** | **74,90** | **0,03573** |

```
sin contar empates : 7/8              = 87,500 %
contando empates   : (7 + 0,03573)/8  = 87,947 %  →  umbral 87,95
```

**Dinámico, pero por el lado del coste.** El umbral se recalcula con los
datos — pero con los de **coste** (cuántos empates hubo y en qué nivel),
nunca con los de acierto. Es la distinción que hace que la comparación
signifique algo:

| | sale de | cambia cuando |
|---|---|---|
| **score** | el historial de aciertos | llega cada dato nuevo |
| **umbral** | la estructura de pago | cambia la escalera, el pago o la frecuencia de empates |

Si el umbral saliera de los aciertos, volveríamos a comparar los datos contra
sí mismos. Y como se deriva de la configuración, pasar a
`max_martingalas = 3` lo mueve solo a 93,75 %.

### 5.2 El score: dos estimaciones, y se exigen las dos

**DIRECTA** — límite inferior del IC95 de Wilson sobre las oportunidades ya
resueltas de este lado. No supone nada del proceso; muestra ~2.100 por lado.

```
p̂ = aciertos/resueltas = 1874/2096 = 0,89408397
IC95 Wilson (z = 1,959963984540054) = [0,88018147 , 0,90654535]
score directo = 100 × 0,88018147 = 88,02
```

**MODELO** — se estima ω, la ventaja del lado apostado, sobre `jugadas`
(~39.000 rondas no-empate, **9× más muestra**) y se propaga por la escalera.
Como `1 − (1−ω)^intentos` es monótona creciente en ω, transformar los
extremos del IC de ω da el IC de la tasa **sin aproximaciones** — nada de
método delta:

```
ω = 19746/39067 = 0,50543937   IC95 = [0,50048129 , 0,51039614]
tasa = 1 − (1−ω)³   → esperada 87,904 %, límite inferior 87,536 %
score modelo = 87,54
```

**El score que decide es el MENOR de los dos**, que es exactamente lo mismo
que exigir que ambos superen el umbral, y deja un único número comparable.

Por qué no uno solo: la directa no supone nada, pero con ~2.100 casos su
intervalo es ancho y llega a estar **2,2 errores estándar por encima** de lo
que predice el modelo — puede venir con suerte. La del modelo es mucho más
precisa, pero apoyada en independencia de rondas. Exigir las dos evita
confiar en la suerte de una y en el supuesto de la otra.

### 5.3 El resultado con los datos de hoy

```
score  = min(directa 88,02 , modelo 87,54) = 87,54
umbral = 87,95
87,54 < 87,95  →  NO TOMAR   ·   EV estimado −0,0325 unidades/operación
```

Apostar PLAYER (tras una racha BANKER) es mucho peor: score 85,04,
EV −0,238.

**Ninguna apuesta pasa hoy, y eso es el sistema funcionando.** El umbral
anterior no podía producir este resultado ni en principio.

### 5.4 Por qué la martingala no arregla nada

```
EV por operación = ventaja_por_unidad × importe_esperado_total
```

La ventaja por unidad no depende de la escalera; la escalera sólo cambia
cuánto se apuesta. Medido:

```
apostar BANKER:  0,44706 − 0,43764 − 0,11530×0,10 = −0,00212  (−0,212 %)
apostar PLAYER:  0,43764 − 0,44706 − 0,11530×0,10 = −0,02094  (−2,094 %)
```

La ventaja del lado BANKER es **+0,94 %** del importe; el peaje del empate,
**−1,15 %**. El peaje es más grande. Y con una ventaja por unidad negativa,
apostar más pierde más:

| gales | intentos | tasa esperada | equilibrio | EV/op | apostado medio |
|---|---|---|---|---|---|
| 0 | 1 | 50,532 % | 50,652 % | −0,00239 | 1,130 |
| 1 | 2 | 75,529 % | 75,648 % | −0,00476 | 2,249 |
| **2** | **3** | **87,895 %** | **87,984 %** | **−0,00711** | **3,355** |
| 3 | 4 | 94,012 % | 94,071 % | −0,00943 | 4,450 |
| 4 | 5 | 97,038 % | 97,074 % | −0,01172 | 5,533 |

Comprueba: `3,355 × (−0,00212) = −0,00711`. Exacto.

Y la propiedad que resume el proyecto entero: **sobre un juego simétrico
(ω = 0,5) y sin peaje, una martingala tiene expectativa EXACTAMENTE cero,
para cualquier profundidad** — porque `1 − (1−½)^n = (2^n−1)/2^n`, que es
justo el equilibrio. La detección de la racha **no aporta nada a la
expectativa**: sólo decide cuándo se juega. Está fijado en
`equilibrio.spec.ts`.

### 5.5 El único parámetro que voltea el signo

| devolución en empate | umbral | EV/op apostando BANKER |
|---|---|---|
| 100 % (push completo) | 87,500 % | **+0,03 → rentable** |
| 95 % | 87,724 % | +0,01 → marginal |
| **90 % (configurado)** | **87,947 %** | **−0,03 → pierde** |

Un 10 % de diferencia en ese único número decide si la estrategia gana o
pierde. Está en `RACHA3_TEST_DEVOLUCION_TIE`, y hay un test que demuestra
que la MISMA evidencia pasa de NO TOMAR a TOMAR al ponerlo en 1 (§9.1b).

## 6. Gates

Un gate **bloquea**; no resta puntos. El orden de evaluación no importa (se
evalúan todos y se reportan todos), pero la decisión es un `AND`.

| Gate | Dispara cuando | Por qué bloquea en vez de penalizar |
|---|---|---|
| `ANALYTICS_SIN_EVIDENCIA` | Analytics falló o devolvió 0 resueltas | Sin evidencia no hay score. `score = null` y **NO TOMAR**. Nunca se inventa ni se reutiliza un score anterior. |
| `ANALYTICS_REZAGADO` | `jugadas_sin_procesar > maxRezagoJugadas` | La evidencia existe pero no está al día. No hay forma defendible de decir «cuánto» resta un rezago de 200 jugadas. |
| `MUESTRA_INSUFICIENTE` | `muestra_n < muestraMinima` | Una muestra insuficiente **no se compensa con puntos**. El IC ya la castiga; el gate impone además un mínimo duro. |
| `OPERACION_VIRTUAL_ABIERTA` | Ya hay una simulación abierta | Réplica del criterio de `ActiveOperationRegistry`: nunca dos operaciones a la vez. |
| `MODELO_SIN_EVIDENCIA` | faltan los conteos de `jugadas` | Sin la segunda estimación no se puede exigir que las dos pasen. Falla cerrado. |
| `SCORE_BAJO_UMBRAL` | el MENOR de las dos estimaciones < umbral | La apuesta no tiene expectativa positiva ni siendo pesimista con la incertidumbre. |

`nivel` distingue el empate exacto: `score == umbral` es `EN_UMBRAL` y **se
toma** (la regla es `>=`). `SIN_EVIDENCIA` cuando `score` es `null`.

---

## 7. Parámetros y configuración

Todas en `.env` (plantilla en [`.env.example`](./.env.example)), leídas en
`src/infrastructure/config/configuration.ts` bajo la clave `racha3Test`:

| Variable | Default | Qué controla |
|---|---|---|
| `RACHA3_TEST_ENABLED` | `false` | Interruptor maestro. Sin `true` el coordinator **no se suscribe a nada** y el canal DEBUG no envía nada. |
| `RACHA3_TEST_UMBRAL_MINIMO` | `0` | Piso adicional. El umbral efectivo es el **mayor** entre éste y el punto de equilibrio, así que sólo puede hacer el sistema más exigente. 0 = manda el equilibrio. |
| `RACHA3_TEST_ESCALERA` | `1,2,4` | Importe por nivel. Su suma es la pérdida por fallo, su longitud el número de intentos. |
| `RACHA3_TEST_DEVOLUCION_TIE` | `0.9` | Fracción que devuelve un empate. **El parámetro que voltea el signo de la estrategia** (§5.5). |
| `RACHA3_TEST_PAGO_ACIERTO` | `1` | Ganancia neta de un acierto. 1 = pago 1:1. |
| `RACHA3_TEST_MIN_MUESTRA` | `500` | Mínimo de oportunidades resueltas que debe respaldar la condición. |
| `RACHA3_TEST_MAX_REZAGO` | `50` | Máximas jugadas sin procesar por Analytics antes de descartar. |
| `RACHA3_TEST_TELEGRAM_BOT_TOKEN` | *(vacío)* | Bot del canal DEBUG. Vacío ⇒ cae a `TELEGRAM_PRUEBAS_BOT_TOKEN`. |
| `RACHA3_TEST_TELEGRAM_CHAT_ID` | *(vacío)* | Chat del canal DEBUG. Vacío ⇒ cae a `TELEGRAM_PRUEBAS_CHAT_ID`. |

Sobre los dos últimos: comparten **destino** con el canal de pruebas sin
compartir **interruptor**. `configuration.ts` normaliza `""` a `undefined`
(helper `opcional()`), porque una variable declarada pero vacía en el `.env`
llega como cadena vacía y el `??` del módulo nunca habría aplicado el respaldo.
Está cubierto en `configuration.racha3-test.spec.ts`.

**Sobre el umbral.** Ya no se escribe a mano: se calcula (§5.1). El valor anterior, 86,87, era el límite inferior del IC95 del histórico GLOBAL, y comparar un subgrupo contra el grupo que lo contiene no es un test de nada. Sustituido por el punto de equilibrio, que sí tiene significado económico y sí puede rechazar todo.

---

## 8. Simulación de operaciones virtuales

Un TOMAR abre una `Racha3TestSimulacion`, que internamente **usa la clase
`Operation` real del motor** con `strategyId: 'racha-3-test'` y
`context: 'pruebas'`. No se reimplementa la martingala: si mañana cambia la
regla de resolución o la neutralidad del TIE, la simulación cambia con ella.

- `max_martingalas = 2`, fijo (DIRECTA → MG1 → MG2 → LOSS).
- El TIE es **neutral**: no gana, no pierde, no avanza el nivel, no tiene tope.
  Se cuenta aparte (`ties`).
- Ignora la jugada que disparó la señal (`triggerGameUuid`), igual que la
  `Operation` real, para no depender del orden de los subscribers del bus.
- **Nunca pasa por `OperationCoordinator` ni por `ActiveOperationRegistry`.** No
  se persiste, no entra en reportes, no cuenta para métricas.
- Un NO TOMAR **no crea simulación**: solo observabilidad.

`Racha3TestSimulationRegistry` modela además la **ventana asíncrona**: entre
detectar la señal y terminar la consulta a Analytics pasan cientos de
milisegundos. `reservar()` es sincrónico y ocupa el hueco durante ese
intervalo; sin él, dos señales seguidas podrían abrir dos simulaciones a la vez,
algo que el motor real nunca haría.

---

## 9. Mensajes DEBUG

Dos tipos, los dos con el análisis completo. Prefijo `🧪` y la palabra
EXPERIMENTAL primero, para que ninguno se confunda con una señal operable ni
leyendo la notificación por encima.

`TelegramChannel` escapa a MarkdownV2 por su cuenta, así que el formatter
escribe texto plano.

### 9.1 El caso real de hoy: NO TOMAR

La mejor apuesta posible (racha PLAYER → apostar BANKER) con los datos de
hoy. La cabecera trae el score que decide y las dos estimaciones, y el
bloque de ECONOMÍA permite auditar el umbral contra la estructura de pago.

```
🧪 RACHA 3 TEST — NO TOMAR
EXPERIMENTAL — no operar. Esta estrategia no crea apuestas reales.

Señal: racha PLAYER de 3 → apostar BANKER
Estado: NO TOMAR
Score: 87.54 / 100 · umbral 87.95 · nivel BAJO_UMBRAL
  = min(directa 88.02, modelo 87.54) — se exigen las dos

ECONOMÍA DE LA APUESTA (de aquí sale el umbral, no del historial)
• gana +1 · falla −7 · empate devuelve 90 %, o sea cuesta el 10 % de lo apostado
• peaje de empates: 0.03573 unidades por operación
• equilibrio sin empates 87.500 % → con empates 87.95 (es el umbral)
• EV estimado: -0.03253 unidades por operación (NEGATIVO: la apuesta pierde dinero)
• ventaja por unidad apostada: -0.192 % — ninguna escalera de martingala la cambia

EVIDENCIA (alimenta el score)
• Condición: tipo_racha=PLAYER
• Muestra (muestra_n): 2096 oportunidades resueltas
• Aciertos: 1874 (directa 1090 + mg1 502 + mg2 282) · pérdidas 222
• tasa_acierto_condicionada: 0.894084
• IC95 Wilson: [0.880181, 0.906545]
• limite_inferior_ic95: 0.880181 → score 87.54
• advertencia_muestra: no
• Ventana de la evidencia: 2026-08-21 18:23 a 2026-09-09 17:01
• Excluidas de la evidencia: 22 bloqueadas · 6 con integridad dudosa incluidas

ESTIMACION POR MODELO (jugadas, ~9x mas muestra)
• lado apostado BANKER: gana 19746 · pierde 19321 · empata 5099
• ventaja del lado (sin contar empates): 0.505439 · IC95 [0.500481, 0.510396]
• tasa de la escalera = 1 − (1−ω)^3: esperada 87.904 %, limite inferior 87.536 %
• supone rondas independientes (medido: P(sigue|k) plana en 0,44)

CONTEXTO (observado, peso 0 — no alimenta el score)
• distancia_actual: 7 jugadas (exacta: sí)
• bucket_distancia: 6-10
• tasa_empirica_condicionada del bucket (hazard, "cuándo aparece la próxima", no "si gana"): 0.1326
• frecuencia_historica del bucket: 0.3819
• hora_colombia: 10
• dia_semana: martes
• columna con corte_por_gap: no
  (medidos sobre el histórico: hora, día y distancia no discriminan el resultado)

COMPONENTES DEL SCORE
• histórico: 1874/2096 → IC95 inferior 0.880181
• muestra: 2096 / mínimo 500 → suficiente
• contexto: peso 0 por diseño
• penalizaciones: ninguna (todo lo que degrada la decisión es un gate)

ESTADO DE ANALYTICS
• disponible: sí
• rezago: 1 jugadas sin procesar
• oportunidades en el histórico: 2096

GATES
✓ ANALYTICS_SIN_EVIDENCIA: Analytics devolvió evidencia utilizable.
✓ MODELO_SIN_EVIDENCIA: 39067 rondas no-empate disponibles.
✓ ANALYTICS_REZAGADO: jugadas sin procesar = 1, máximo permitido = 50
✓ MUESTRA_INSUFICIENTE: muestra_n = 2096, mínimo requerido = 500
✓ OPERACION_VIRTUAL_ABIERTA: Sin operación virtual en curso.
✗ SCORE_BAJO_UMBRAL: score = 87.54 (directa 88.02, modelo 87.54), umbral = 87.95

RAZONES
• Muestra suficiente: 2096 oportunidades resueltas (mínimo 500).
• La estimación por modelo alcanza el equilibrio 87.95 (directa 88.02, modelo 87.54): la apuesta pierde 0.0325 unidades por operación.
• La ventaja por unidad apostada del lado BANKER es -0.192%: negativa, y ninguna escalera de martingala la corrige.

ADVERTENCIAS
• La evidencia incluye 6 oportunidad(es) con integridad dudosa sobre 2096.

TRAZA (verificable a mano)
1. Umbral (estructura de pago, no del historial de aciertos):
   escalera = [1, 2, 4] → pérdida por fallo = 7, ganancia por acierto = 1
   equilibrio sin contar empates = 7/8 = 87.500%
     nivel 0: 269 empates × 1 × (1 − 0.9) = 26.90 unidades
     nivel 1: 126 empates × 2 × (1 − 0.9) = 25.20 unidades
     nivel 2: 57 empates × 4 × (1 − 0.9) = 22.80 unidades
   peaje de empates = 74.90 / 2096 operaciones = 0.03573 unidades por operación
   umbral = (7 + 0.03573) / 8 = 87.947%
   umbral efectivo = max(mínimo 0, equilibrio 87.947) = 87.95
2. DIRECTA — Analytics (condición "tipo_racha=PLAYER"): aciertos=1874 de resueltas=2096 (directa=1090 + mg1=502 + mg2=282), perdidas=222
   p = 1874/2096 = 0.89408397
   IC95 Wilson (z=1.959964) = [0.88018121, 0.90654485] → score directo = 88.02
3. MODELO — ventaja del lado BANKER sobre jugadas (corte 44745): gana=19746 pierde=19321 empata=5099
   ω = 19746/39067 = 0.50543937 · IC95 = [0.50048130, 0.51039638]
   tasa = 1 − (1−ω)^3 → esperada 87.904%, límite inferior 87.536% → score modelo = 87.54
   ventaja por unidad apostada = -0.00192 (-0.192%) — ninguna escalera la cambia
4. score = min(directa 88.02, modelo 87.54) = 87.54 (exigir las dos ≡ exigirlo del mínimo)
5. EV estimado = 0.875400×1 − 0.124600×7 − 0.03573 = -0.03253 unidades/operación
6. Gates: ANALYTICS_SIN_EVIDENCIA=ok · MODELO_SIN_EVIDENCIA=ok · ANALYTICS_REZAGADO=ok · MUESTRA_INSUFICIENTE=ok · OPERACION_VIRTUAL_ABIERTA=ok · SCORE_BAJO_UMBRAL=BLOQUEA
7. Decisión: NO TOMAR

Resultado: NO TOMAR (descartada por SCORE_BAJO_UMBRAL)

evaluacionId: 3f5a1c2e-7b48-4d09-9a61-8c2d4e6f0a15
triggerGameUuid: a1c9f4e2-5d3b-4c88-9f10-6e2b7a4d0c31
evaluada: 2026-09-09T15:41:03.204Z
```

La sección TRAZA permite recorrer a mano `estructura de pago → umbral →
conteos → tasa → IC95 → dos estimaciones → score → EV → gates → decisión`
sin creerle nada al programa.

### 9.1b La misma evidencia con devolución del 100 %: TOMAR

El único parámetro que voltea el signo. Con `RACHA3_TEST_DEVOLUCION_TIE=1`,
y exactamente los mismos datos, el peaje desaparece, el umbral baja a 87,50
y la apuesta pasa a tener expectativa positiva:

```
🧪 RACHA 3 TEST — TOMAR
Estado: TOMAR
Score: 87.54 / 100 · umbral 87.5 · nivel SOBRE_UMBRAL
  = min(directa 88.02, modelo 87.54) — se exigen las dos

ECONOMÍA DE LA APUESTA (de aquí sale el umbral, no del historial)
• gana +1 · falla −7 · empate devuelve 100 %, o sea cuesta el 0 % de lo apostado
• peaje de empates: 0.00000 unidades por operación
• equilibrio sin empates 87.500 % → con empates 87.5 (es el umbral)
• EV estimado: 0.00320 unidades por operación (positivo)
• ventaja por unidad apostada: 0.962 % — ninguna escalera de martingala la cambia

```

### 9.2 NO TOMAR — cada gate dice qué lo descartó

**Analytics caído** — sin evidencia no hay score, y un fallo nunca produce
un score favorable:

```
🧪 RACHA 3 TEST — NO TOMAR
Estado: NO TOMAR
Score: sin evidencia (umbral 87.5)

ECONOMÍA DE LA APUESTA (de aquí sale el umbral, no del historial)
• gana +1 · falla −7 · empate devuelve 90 %, o sea cuesta el 10 % de lo apostado
• peaje de empates: 0.00000 unidades por operación
• equilibrio sin empates 87.500 % → con empates 87.5 (es el umbral)
• EV estimado: n/d (sin evidencia)
```

**Analytics rezagado** — el caso que muestra que un gate no es un score
bajo: score por encima del umbral y aun así NO TOMAR.

```
🧪 RACHA 3 TEST — NO TOMAR
Estado: NO TOMAR
Score: 87.54 / 100 · umbral 87.5 · nivel SOBRE_UMBRAL
  = min(directa 88.02, modelo 87.54) — se exigen las dos

ECONOMÍA DE LA APUESTA (de aquí sale el umbral, no del historial)
• gana +1 · falla −7 · empate devuelve 100 %, o sea cuesta el 0 % de lo apostado
```

### 9.3 Simulación resuelta

```
🧪 RACHA 3 TEST — simulación resuelta
EXPERIMENTAL — operación VIRTUAL, no fue una apuesta real.

Evaluación: 3f5a1c2e-7b48-4d09-9a61-8c2d4e6f0a15
Racha: PLAYER → apuesta BANKER
Score con el que se tomó: 87.54

Resultado simulado: MG1
Jugadas evaluadas: 2 (empates neutrales: 0)
Resuelta: 2026-09-08T15:42:49.512Z
```

El `evaluacionId` es el que une los dos mensajes.

---

## 10. Observabilidad: logs estructurados

Contexto de logger `Racha3Test`. Todas las líneas llevan
`evaluacionId=<uuid v4>` como **id de correlación**.

| Evento | Nivel | Cuándo | Campos |
|---|---|---|---|
| `racha3_test_signal` | log | se confirmó una oportunidad | `triggerGameUuid`, `tipoRacha`, `apuesta`, `horaColombia` |
| `racha3_test_score` | log | score calculado | `score`, `umbral`, `nivel`, `directo`, `modelo`, `ev`, `peajeTie`, `muestraN`, `tasaObservada`, `icInferior`, `rezago` |
| `racha3_test_decision` | log | decisión tomada | `decision`, `gatesDisparados=[...]` |
| `racha3_test_debug` | debug | antes de enviar el mensaje | — |
| `racha3_test_simulacion_resuelta` | log | cerró una operación virtual | `resultado`, `jugadas`, `ties`, `score` |
| `racha3_test_error` | error | falló la evaluación | mensaje del error |

Ejemplo real (de `racha3-test.coordinator.spec.ts`):

```
racha3_test_signal evaluacionId=1cb7880f-… triggerGameUuid=game-3 tipoRacha=PLAYER apuesta=BANKER horaColombia=10
racha3_test_score  evaluacionId=1cb7880f-… score=87.54 umbral=87.95 nivel=BAJO_UMBRAL directo=88.02 modelo=87.54 ev=-0.03253 peajeTie=0.03573 muestraN=2096 tasaObservada=0.894084 icInferior=0.880181 rezago=1
racha3_test_decision evaluacionId=1cb7880f-… decision=TOMAR gatesDisparados=[]
racha3_test_simulacion_resuelta evaluacionId=1cb7880f-… resultado=DIRECTA jugadas=1 ties=0 score=87.54
```

**No se escribe una línea por jugada.** Sin oportunidad confirmada no hay log
ni DEBUG: serían ~2.600 mensajes al día para decir que no pasó nada. Está
cubierto por el test `no escribe una línea por jugada cuando no hay
oportunidad`.

---

## 11. Backtest: retrospectivo vs walk-forward

```bash
pnpm racha3-test:backtest
```

El script (`scripts/racha3-test-backtest.ts`) corre **dos** evaluaciones sobre el
mismo histórico, y la diferencia entre las dos es el punto del ejercicio.

**Análisis retrospectivo** — calcula la tasa con todo el histórico y después la
aplica a cada oportunidad de ese mismo histórico. **Tiene fuga de información
por construcción**: para decidir sobre la oportunidad n.º 500 usa el resultado
de la n.º 3.000, que en vivo no existía. Sus números son optimistas y no son
una expectativa de rendimiento.

**Simulación temporal walk-forward** — para cada oportunidad usa exclusivamente
las que ya estaban **RESUELTAS** antes del instante de su confirmación. El
criterio es deliberadamente estricto: una Racha 3 se confirma y tarda hasta 3
jugadas (más TIE) en resolverse, así que al confirmar hay operaciones abiertas
cuyo resultado todavía no es evidencia; contarlas sería una fuga sutil y difícil
de ver después.

### Resultados (histórico al 2026-09-09, 4.225 oportunidades resueltas y no bloqueadas)

Umbral calculado: **87,982 %** (peaje de empates 0,03859 u/op; sin empates
serían 87,500 %).

|  | Retrospectivo (con fuga) | **Walk-forward (sin fuga)** |
|---|---|---|
| Oportunidades evaluadas | 4.224 | 4.225 |
| TOMAR | 2.096 (49,62 %) | **32 (0,76 %)** |
| NO TOMAR | 2.128 (50,38 %) | **4.193 (99,24 %)** |
| · por muestra insuficiente | 0 | 1.000 |
| · por score bajo umbral | 2.128 | 3.193 |
| Errores de Analytics | 0 (no aplica offline) | 0 (no aplica offline) |
| Score promedio | 86,52 | **84,71** |

Distribución del score, walk-forward:

| Bucket | n | % |
|---|---|---|
| < 80 | 96 | 2,27 % |
| 80 – 84 | 1.093 | 25,87 % |
| 84 – 86 | 1.464 | 34,65 % |
| 86 – 87,98 | 1.538 | 36,40 % |
| **87,98 – 88 (TOMAR)** | **3** | **0,07 %** |
| 88 – 90 | 29 | 0,69 % |
| ≥ 90 | 0 | 0 % |
| sin score (evidencia vacía) | 2 | — |

Resultado histórico, walk-forward:

| Grupo | n | acierto | IC95 | directa | mg1 | mg2 | loss |
|---|---|---|---|---|---|---|---|
| **TOMAR** | 32 | 90,63 % | [75,78 – 96,76] | 59,38 % | 21,88 % | 9,38 % | 9,38 % |
| NO TOMAR | 4.193 | 87,96 % | [86,94 – 88,91] | 49,84 % | 25,02 % | 13,09 % | 12,04 % |
| todas | 4.225 | 87,98 % | [86,96 – 88,92] | 49,92 % | 24,99 % | 13,07 % | 12,02 % |

Separación TOMAR vs NO TOMAR: **+2,67 pp, z = 0,52** → **NO distinguible
del ruido al 95 %**.

Todos los TOMAR son de `tipo_racha = PLAYER`, es decir apuestas a BANKER.

### Lectura honesta

**Con el umbral correcto, la estrategia no tiene ventaja demostrable.**

- Se toman **32 de 4.225** oportunidades (0,76 %), y esas 32 aciertan el
  90,63 % contra el 87,96 % del resto: **z = 0,52**, indistinguible del
  ruido. Con n=32 el IC95 va de 75,78 a 96,76: no dice nada.
- Y estos números son **optimistas**: el backtest sólo evalúa la estimación
  directa. En vivo se exige además la del modelo, que hoy da 87,54 contra un
  umbral de 87,95 — así que el TOMAR real sería aún menor, probablemente
  cero.
- La razón de fondo está en §5.4: la ventaja por unidad apostada es negativa
  (−0,212 % apostando BANKER), y ninguna escalera de martingala corrige un
  porcentaje negativo. El peaje del empate (−1,15 % del importe) es mayor
  que la ventaja del lado del banco (+0,94 %).
- Los 1.000 descartes por muestra insuficiente son el arranque en frío del
  walk-forward: hasta cruzar las 500 resueltas por condición no se toma
  nada. En vivo eso ya está cubierto, el histórico existe.

Comparación con el diseño anterior sobre los mismos datos: el umbral de
86,87 tomaba **600 oportunidades (14,75 %)** y reportaba z = 2,30. Ese
resultado venía de comparar un subgrupo contra el grupo que lo contiene, no
de una ventaja económica. El umbral de equilibrio lo deshace.

---

## 12. Comportamiento ante fallos

La regla es una sola: **un fallo nunca puede terminar en una decisión
favorable.**

| Fallo | Qué hace |
|---|---|
| Analytics no responde (`P1001`, timeout) | `evidencia: null`, gate `ANALYTICS_SIN_EVIDENCIA`, `score = null`, **NO TOMAR**, DEBUG con el error. No abre simulación. |
| Analytics responde sin datos (0 resueltas) | Igual que el anterior. |
| Analytics rezagado | Gate `ANALYTICS_REZAGADO`, **NO TOMAR** aunque el score esté sobre el umbral. |
| El provider **lanza** | Se captura en `evaluar()`: `liberarReserva()`, log `racha3_test_error`, **ningún** DEBUG ni simulación. |
| La detección lanza | Se captura en `detectar()`: se descarta esa jugada con un `warn`. El motor real no se ve afectado. |
| El envío a Telegram falla | Se registra un `warn`. No propaga: no enviar un mensaje de observabilidad no invalida la evaluación, que ya quedó en el log. |
| `PrismaService` deshabilitado (sin `DATABASE_URL`) | El módulo levanta igual; toda evaluación cae en `ANALYTICS_SIN_EVIDENCIA`. |

**Nunca** se inventa un score, nunca se reutiliza en silencio uno anterior y
nunca se asume evidencia favorable.

---

## 13. Archivos, tests y comandos

### `core/` — TypeScript puro, sin `@nestjs/*`

| Archivo | Qué es |
|---|---|
| `src/core/racha3-test/wilson.ts` | `intervaloWilson()`, `Z_95`. Determinístico y acotado a [0,1]. |
| `src/core/racha3-test/equilibrio.ts` | Punto de equilibrio, peaje de empates, EV por operación y ventaja por unidad apostada. Es donde vive el umbral. |
| `src/core/racha3-test/types/racha3-test.type.ts` | `RACHA3_TEST_ID`, evidencia, contexto, gates, score, parámetros, evaluación, resolución. |
| `src/core/racha3-test/racha3-test-score.calculator.ts` | `calcularRacha3TestScore()`. Función pura, sin estado oculto. |
| `src/core/racha3-test/racha3-test-simulation.ts` | `Racha3TestSimulacion` sobre la `Operation` real. `RACHA3_TEST_MAX_MARTINGALAS = 2`. |
| `src/core/racha3-test/racha3-test-debug.formatter.ts` | Los dos mensajes de Telegram. |

### `application/` — orquestación

| Archivo | Qué es |
|---|---|
| `src/application/racha3-test/racha3-test.coordinator.ts` | Suscriptor de `GameReceivedEvent`. Detecta, evalúa, decide, simula, notifica. |
| `src/application/racha3-test/racha3-test.evidence-provider.ts` | Consulta Analytics vía `Racha3AnalyticsReadModel`. **No duplica SQL en TypeScript.** |
| `src/application/racha3-test/racha3-test-simulation.registry.ts` | Registro de la operación virtual + reserva de la ventana asíncrona. |
| `src/application/racha3-test/racha3-test-debug.notifier.ts` | Envía al canal DEBUG sin pasar por el dispatcher. |
| `src/application/racha3-test/racha3-test.module.ts` | Cableado, incluido el canal DEBUG fuera de `NOTIFICATION_CHANNELS`. |

### Tests — 131, todos en verde

```bash
pnpm test --testPathPatterns=racha3-test
```

| Suite | n | Cubre |
|---|---|---|
| `core/racha3-test/wilson.spec.ts` | 7 | Reproduce los límites inferiores del histórico; monotonía con la muestra; sin `NaN`; determinismo. |
| `core/racha3-test/equilibrio.spec.ts` | 20 | El peaje medido, el umbral, que NO depende de los aciertos, y que una martingala sobre un juego simétrico da EV **exactamente cero** a cualquier profundidad. |
| `core/racha3-test/racha3-test-score.calculator.spec.ts` | 35 | Umbral desde la estructura de pago, las dos estimaciones, cada gate, y que la devolución del empate voltea la decisión. |
| `core/racha3-test/racha3-test-simulation.spec.ts` | 13 | DIRECTA/MG1/MG2/LOSS, TIE neutral y sin tope, `max_martingalas = 2`, ignora el trigger. |
| `application/racha3-test/racha3-test.coordinator.spec.ts` | 29 | Detección, decisión, fallo seguro, logs estructurados y **el aislamiento de `streak-3`**. |
| `application/racha3-test/racha3-test-simulation.registry.spec.ts` | 11 | Reserva, apertura, cierre, doble liberación. |
| `application/racha3-test/racha3-test.module.spec.ts` | 10 | Cableado DI real; canal DEBUG fuera de `NOTIFICATION_CHANNELS`; `racha-3-test` fuera de `STRATEGIES`. |
| `infrastructure/config/configuration.racha3-test.spec.ts` | 6 | Defaults; solo `"true"` enciende; `""` cae al respaldo. |

### Comandos

```bash
pnpm racha3-test:backtest                        # retrospectivo + walk-forward
pnpm test --testPathPatterns=racha3-test         # las 7 suites
```

---

## 14. Limitaciones conocidas

Están acá porque documentarlas es más útil que esconderlas.

1. **El umbral ya no se deriva del historial de aciertos** — sale de la
   estructura de pago (§5.1). Lo único que toma de los datos es el peaje de
   los empates, que es un coste medido, no un resultado. Queda una fuga
   menor: ese peaje se mide sobre todo el histórico, no walk-forward.
2. **El backtest excluye las oportunidades con
   `bloqueada_por_operacion_previa`** (50 de 4.102). Al filtrar, el hueco de
   «una operación a la vez» quedaría libre en momentos en que históricamente
   estaba ocupado, y ahí podrían haberse tomado algunas de esas. El backtest no
   las recupera. El sesgo existe, es conocido y no se estima.
3. **No hay ventaja demostrable.** Con el umbral de equilibrio el Con 2,67 pp de diferencia
   entre PLAYER y BANKER, la potencia estadística exigiría ≈ 2.354
   oportunidades por grupo y hay ≈ 2.035.
4. **La tasa histórica no es una probabilidad de la próxima jugada.** El score
   describe lo que ya pasó, con su incertidumbre. No es `probabilidad`,
   `predicción` ni `confianza`.
5. **La ventana del histórico es corta** (2026-08-21 a 2026-09-08). Cualquier
   estructura estacional más larga que eso es invisible.
6. **Hereda las deudas de Analytics** registradas en
   [`ANALYTICS.md`](./ANALYTICS.md) §11: `PrismaService` conecta una vez en
   `onModuleInit` y no reintenta, y el RTT pooled (~324 ms) es ~5× el directo.
   Con el pooler caído al arrancar, toda evaluación cae en
   `ANALYTICS_SIN_EVIDENCIA` durante la vida del proceso — falla cerrado, que es
   el comportamiento correcto, pero el experimento queda inerte hasta
   reiniciar.
7. **Solo hay una condición en el score** (`tipo_racha`). Si con más histórico
   otro rasgo del bloque `contexto` empieza a mostrar estructura, habrá que
   volver a medir antes de darle peso — no al revés.

---

## Referencias

- [`ANALYTICS.md`](./ANALYTICS.md) — el dominio Analytics del que sale la
  evidencia: tablas derivadas, funciones de agregación, terminología.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — capas, `DomainEventBus`, decisiones
  de diseño del motor.
- [`Mk-Api.md`](./Mk-Api.md) — ADRs de `src/api/`, incluido el registro de
  canales y estrategias.
- [`.env.example`](./.env.example) — plantilla de las variables.

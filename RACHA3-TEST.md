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

```
Entrada, de racha3_resumen(tipo_racha) — conteos CRUDOS, no tasas redondeadas:
    aciertos   = directa + mg1 + mg2
    resueltas  = muestra_n

1.  p̂ = aciertos / resueltas

2.  IC95 de Wilson, con z = 1,959963984540054:

        denominador = 1 + z²/n
        centro      = (p̂ + z²/(2n)) / denominador
        margen      = (z / denominador) · √( p̂(1−p̂)/n + z²/(4n²) )

        límite_inferior = máx(0, centro − margen)
        límite_superior = mín(1, centro + margen)

3.  score = redondear2( 100 × límite_inferior )

4.  penalizaciones = ninguna (por diseño, ver §4)

5.  tomar = (ningún gate disparado) Y (score >= umbral)
```

Wilson y no la aproximación normal porque las tasas están cerca de 0,88 y
Wilson mantiene mejor cobertura en los extremos. **El umbral aprobado
inicialmente (86,91) venía de la aproximación normal; el valor de Wilson sobre
los mismos conteos es 86,87, y ese es el que quedó configurado.**

El límite inferior es también la razón por la que **no hace falta un componente
separado de «tamaño de muestra»**: con la misma tasa, una muestra chica produce
un límite inferior más bajo, automáticamente y sin parámetros que ajustar.

```
intervaloWilson(9,   10)   → p̂ = 0,9000  límite inferior 0,595850 → score 59,58
intervaloWilson(900, 1000) → p̂ = 0,9000  límite inferior 0,879848 → score 87,98
```

### Verificación numérica

Conteos reales del histórico al 2026-09-08, reproducibles con
`GET /api/v1/analytics/racha3/resumen`:

| Condición | aciertos / resueltas | p̂ | IC95 Wilson | score |
|---|---|---|---|---|
| GLOBAL | 3577 / 4069 | 0,87908577 | [0,86867, 0,88872] | **86,87** |
| `tipo_racha=PLAYER` | 1802 / 2019 | 0,89252105 | [0,87826, 0,90529] | **87,83** |
| `tipo_racha=BANKER` | 1775 / 2050 | 0,86585366 | [0,85041, 0,87992] | **85,04** |

Estos tres valores están fijados en `wilson.spec.ts`: si el test falla, el
umbral configurado dejó de corresponder a su origen.

Consecuencia directa y que conviene decir en voz alta: con el umbral en 86,87,
la regla **se reduce hoy a «tomar solo las rachas PLAYER»**, porque PLAYER está
sobre el umbral y BANKER debajo. No es un efecto colateral escondido — es lo
que la única evidencia discriminante disponible permite afirmar.

---

## 6. Gates

Un gate **bloquea**; no resta puntos. El orden de evaluación no importa (se
evalúan todos y se reportan todos), pero la decisión es un `AND`.

| Gate | Dispara cuando | Por qué bloquea en vez de penalizar |
|---|---|---|
| `ANALYTICS_SIN_EVIDENCIA` | Analytics falló o devolvió 0 resueltas | Sin evidencia no hay score. `score = null` y **NO TOMAR**. Nunca se inventa ni se reutiliza un score anterior. |
| `ANALYTICS_REZAGADO` | `jugadas_sin_procesar > maxRezagoJugadas` | La evidencia existe pero no está al día. No hay forma defendible de decir «cuánto» resta un rezago de 200 jugadas. |
| `MUESTRA_INSUFICIENTE` | `muestra_n < muestraMinima` | Una muestra insuficiente **no se compensa con puntos**. El IC ya la castiga; el gate impone además un mínimo duro. |
| `OPERACION_VIRTUAL_ABIERTA` | Ya hay una simulación abierta | Réplica del criterio de `ActiveOperationRegistry`: nunca dos operaciones a la vez. |
| `SCORE_BAJO_UMBRAL` | `score < umbralScore` | Es la regla del experimento. |

`nivel` distingue el empate exacto: `score == umbral` es `EN_UMBRAL` y **se
toma** (la regla es `>=`). `SIN_EVIDENCIA` cuando `score` es `null`.

---

## 7. Parámetros y configuración

Todas en `.env` (plantilla en [`.env.example`](./.env.example)), leídas en
`src/infrastructure/config/configuration.ts` bajo la clave `racha3Test`:

| Variable | Default | Qué controla |
|---|---|---|
| `RACHA3_TEST_ENABLED` | `false` | Interruptor maestro. Sin `true` el coordinator **no se suscribe a nada** y el canal DEBUG no envía nada. |
| `RACHA3_TEST_SCORE_THRESHOLD` | `86.87` | Umbral del score para TOMAR. |
| `RACHA3_TEST_MIN_MUESTRA` | `500` | Mínimo de oportunidades resueltas que debe respaldar la condición. |
| `RACHA3_TEST_MAX_REZAGO` | `50` | Máximas jugadas sin procesar por Analytics antes de descartar. |
| `RACHA3_TEST_TELEGRAM_BOT_TOKEN` | *(vacío)* | Bot del canal DEBUG. Vacío ⇒ cae a `TELEGRAM_PRUEBAS_BOT_TOKEN`. |
| `RACHA3_TEST_TELEGRAM_CHAT_ID` | *(vacío)* | Chat del canal DEBUG. Vacío ⇒ cae a `TELEGRAM_PRUEBAS_CHAT_ID`. |

Sobre los dos últimos: comparten **destino** con el canal de pruebas sin
compartir **interruptor**. `configuration.ts` normaliza `""` a `undefined`
(helper `opcional()`), porque una variable declarada pero vacía en el `.env`
llega como cadena vacía y el `??` del módulo nunca habría aplicado el respaldo.
Está cubierto en `configuration.racha3-test.spec.ts`.

**Sobre el umbral 86,87.** Es el límite inferior del IC95 del histórico
**GLOBAL**. El criterio: *«solo tomar una oportunidad cuya tasa defendible sea
al menos tan buena como el histórico completo»*. Es un umbral **experimental
inicial, no un valor universal**: al crecer el histórico el límite se mueve y
hay que revisarlo. Y se derivó del mismo histórico sobre el que después se
mide (§14).

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

### 9.1 TOMAR

```
🧪 RACHA 3 TEST — TOMAR
EXPERIMENTAL — no operar. Esta estrategia no crea apuestas reales.

Señal: racha PLAYER de 3 → apostar BANKER
Estado: TOMAR
Score: 87.83 / 100 · umbral 86.87 · nivel SOBRE_UMBRAL

EVIDENCIA (alimenta el score)
• Condición: tipo_racha=PLAYER
• Muestra (muestra_n): 2019 oportunidades resueltas
• Aciertos: 1802 (directa 1048 + mg1 483 + mg2 271) · pérdidas 217
• tasa_acierto_condicionada: 0.892521
• IC95 Wilson: [0.878258, 0.905293]
• limite_inferior_ic95: 0.878258 → score 87.83
• advertencia_muestra: no
• Ventana de la evidencia: 2026-06-10 15:00 a 2026-09-08 01:20
• Excluidas de la evidencia: 25 bloqueadas · 5 con integridad dudosa incluidas

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
• histórico: 1802/2019 → IC95 inferior 0.878258
• muestra: 2019 / mínimo 500 → suficiente
• contexto: peso 0 por diseño
• penalizaciones: ninguna (todo lo que degrada la decisión es un gate)

ESTADO DE ANALYTICS
• disponible: sí
• rezago: 1 jugadas sin procesar
• oportunidades en el histórico: 4119

GATES
✓ ANALYTICS_SIN_EVIDENCIA: Analytics devolvió evidencia utilizable.
✓ ANALYTICS_REZAGADO: jugadas sin procesar = 1, máximo permitido = 50
✓ MUESTRA_INSUFICIENTE: muestra_n = 2019, mínimo requerido = 500
✓ OPERACION_VIRTUAL_ABIERTA: Sin operación virtual en curso.
✓ SCORE_BAJO_UMBRAL: score = 87.83, umbral = 86.87

RAZONES
• Muestra suficiente: 2019 oportunidades resueltas (mínimo 500).
• Tasa defendible 87.83 ≥ umbral 86.87: la evidencia respalda la oportunidad.

ADVERTENCIAS
• La evidencia incluye 5 oportunidad(es) con integridad dudosa sobre 2019.

TRAZA (verificable a mano)
1. Analytics (condición "tipo_racha=PLAYER"): aciertos=1802 de resueltas=2019 (directa=1048 + mg1=483 + mg2=271), perdidas=217
2. Tasa observada: p = 1802/2019 = 0.89252105
3. IC95 Wilson (z=1.959964): centro=0.89177564 margen=0.01351759 → [0.87825804, 0.90529323]
4. score = 100 × límite_inferior = 100 × 0.87825804 = 87.83
5. Penalizaciones: ninguna (por diseño; ver el comentario de la calculadora)
6. Gates: ANALYTICS_SIN_EVIDENCIA=ok · ANALYTICS_REZAGADO=ok · MUESTRA_INSUFICIENTE=ok · OPERACION_VIRTUAL_ABIERTA=ok · SCORE_BAJO_UMBRAL=ok
7. Decisión: TOMAR

Resultado: TOMAR (se abre una operación VIRTUAL; no se apuesta nada)

evaluacionId: 3f5a1c2e-7b48-4d09-9a61-8c2d4e6f0a15
triggerGameUuid: a1c9f4e2-5d3b-4c88-9f10-6e2b7a4d0c31
evaluada: 2026-09-08T15:41:03.204Z
```

La sección TRAZA es el requisito 13 del diseño: permite recorrer a mano
`datos Analytics → tasa → IC95 → límite inferior → penalizaciones → score →
gates → decisión` sin creerle nada al programa.

### 9.2 NO TOMAR — cada gate dice exactamente qué lo descartó

Las secciones son las mismas; cambia el cierre y el gate marcado con `✗`.

**Score bajo umbral** (racha BANKER):

```
🧪 RACHA 3 TEST — NO TOMAR
Score: 85.04 / 100 · umbral 86.87 · nivel BAJO_UMBRAL
...
✗ SCORE_BAJO_UMBRAL: score = 85.04, umbral = 86.87
RAZONES
• Tasa defendible 85.04 < umbral 86.87: la evidencia no alcanza para respaldarla.
Resultado: NO TOMAR (descartada por SCORE_BAJO_UMBRAL)
```

**Analytics caído**:

```
🧪 RACHA 3 TEST — NO TOMAR
Score: sin evidencia (umbral 86.87)

EVIDENCIA (alimenta el score)
• No se pudo obtener evidencia de Analytics.
...
ESTADO DE ANALYTICS
• disponible: NO
• error: Can't reach database server at `[REGION].pooler.supabase.com:6543`

GATES
✗ ANALYTICS_SIN_EVIDENCIA: Can't reach database server at `...:6543`

TRAZA (verificable a mano)
1. Analytics: sin evidencia utilizable → score = null
2. Decisión: NO TOMAR (un fallo de evidencia nunca produce score favorable)

Resultado: NO TOMAR (descartada por ANALYTICS_SIN_EVIDENCIA)
```

**Muestra insuficiente** (120 resueltas): dispara `MUESTRA_INSUFICIENTE` **y**
`SCORE_BAJO_UMBRAL`, porque el IC ancho de una muestra chica ya baja el score
por su cuenta (81,37 con p̂ = 0,883):

```
✗ MUESTRA_INSUFICIENTE: muestra_n = 120, mínimo requerido = 500
✗ SCORE_BAJO_UMBRAL: score = 81.37, umbral = 86.87
ADVERTENCIAS
• Analytics advierte sobre el tamaño de muestra: muestra_n < 500.
Resultado: NO TOMAR (descartada por MUESTRA_INSUFICIENTE, SCORE_BAJO_UMBRAL)
```

**Analytics rezagado** — el caso que muestra que un gate no es un score bajo:
score 87,83 **sobre** el umbral y aun así NO TOMAR.

```
Score: 87.83 / 100 · umbral 86.87 · nivel SOBRE_UMBRAL
✗ ANALYTICS_REZAGADO: jugadas sin procesar = 371, máximo permitido = 50
✓ SCORE_BAJO_UMBRAL: score = 87.83, umbral = 86.87
RAZONES
• Analytics rezagado en 371 jugadas: la evidencia no está al día.
Resultado: NO TOMAR (descartada por ANALYTICS_REZAGADO)
```

### 9.3 Simulación resuelta

```
🧪 RACHA 3 TEST — simulación resuelta
EXPERIMENTAL — operación VIRTUAL, no fue una apuesta real.

Evaluación: 3f5a1c2e-7b48-4d09-9a61-8c2d4e6f0a15
Racha: PLAYER → apuesta BANKER
Score con el que se tomó: 87.83

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
| `racha3_test_score` | log | score calculado | `score`, `umbral`, `nivel`, `muestraN`, `tasaObservada`, `icInferior`, `rezago` |
| `racha3_test_decision` | log | decisión tomada | `decision`, `gatesDisparados=[...]` |
| `racha3_test_debug` | debug | antes de enviar el mensaje | — |
| `racha3_test_simulacion_resuelta` | log | cerró una operación virtual | `resultado`, `jugadas`, `ties`, `score` |
| `racha3_test_error` | error | falló la evaluación | mensaje del error |

Ejemplo real (de `racha3-test.coordinator.spec.ts`):

```
racha3_test_signal evaluacionId=1cb7880f-… triggerGameUuid=game-3 tipoRacha=PLAYER apuesta=BANKER horaColombia=10
racha3_test_score  evaluacionId=1cb7880f-… score=87.83 umbral=86.87 nivel=SOBRE_UMBRAL muestraN=2019 tasaObservada=0.892521 icInferior=0.878258 rezago=1
racha3_test_decision evaluacionId=1cb7880f-… decision=TOMAR gatesDisparados=[]
racha3_test_simulacion_resuelta evaluacionId=1cb7880f-… resultado=DIRECTA jugadas=1 ties=0 score=87.83
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

### Resultados (histórico al 2026-09-08, 4.069 oportunidades resueltas y no bloqueadas, 10 con integridad dudosa incluidas)

Ventana: `2026-08-21T18:23:15Z` … `2026-09-08T01:20:16Z`.

|  | Retrospectivo (con fuga) | **Walk-forward (sin fuga)** |
|---|---|---|
| Oportunidades evaluadas | 4.069 | 4.069 |
| TOMAR | 2.019 (49,62 %) | **600 (14,75 %)** |
| NO TOMAR | 2.050 (50,38 %) | **3.469 (85,25 %)** |
| · por muestra insuficiente | 0 | **1.000** |
| · por score bajo umbral | 2.050 | 2.469 |
| Errores de Analytics | 0 (no aplica offline) | 0 (no aplica offline) |
| Score promedio | 86,42 | **84,65** |

Distribución del score, walk-forward:

| Bucket | n | % |
|---|---|---|
| < 80 | 96 | 2,36 % |
| 80 – 84 | 1.093 | 26,86 % |
| 84 – 86 | 1.385 | 34,04 % |
| 86 – 86,87 | 890 | 21,87 % |
| **86,87 – 88 (TOMAR)** | **603** | **14,82 %** |
| 88 – 90 | 0 | 0 % |
| ≥ 90 | 0 | 0 % |
| sin score (evidencia vacía) | 2 | — |

> Los 603 del bucket y los 600 TOMAR difieren en 3: son evaluaciones cuyo score
> cae en `[86,87 – 88)` pero que un gate distinto descartó.

Resultado histórico, walk-forward:

| Grupo | n | acierto | IC95 | directa | mg1 | mg2 | loss |
|---|---|---|---|---|---|---|---|
| **TOMAR** | 600 | **90,50 %** | [87,89 – 92,60] | 54,17 % | 22,17 % | 14,17 % | **9,50 %** |
| NO TOMAR | 3.469 | 87,46 % | [86,32 – 88,52] | 49,41 % | 25,40 % | 12,65 % | 12,54 % |
| todas | 4.069 | 87,91 % | [86,87 – 88,87] | 50,11 % | 24,92 % | 12,88 % | 12,09 % |

Separación TOMAR vs NO TOMAR: **+3,04 pp, z = 2,30** → distinguible del ruido
al 95 %. (Retrospectivo: +2,67 pp, z = 2,61.)

Todos los TOMAR son de `tipo_racha = PLAYER`, consecuencia directa de §5.

### Lectura honesta

El filtro **sí** separa, y la separación sobrevive a su propio error estándar.
Pero:

- `z = 2,30` con una sola condición evaluada está apenas por encima del umbral
  convencional. No es un resultado establecido, es un resultado que **amerita
  seguir midiendo en vivo**, que es exactamente para lo que existe esta
  estrategia.
- El precio es el volumen: de 4.069 oportunidades se toman 600 (**14,75 %**).
- Los 1.000 descartes por muestra insuficiente son el arranque en frío del
  walk-forward: hasta cruzar las 500 resueltas por condición no se toma nada.
  En vivo eso ya está cubierto — el histórico existe.

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

### Tests — 100, todos en verde

```bash
pnpm test --testPathPatterns=racha3-test
```

| Suite | n | Cubre |
|---|---|---|
| `core/racha3-test/wilson.spec.ts` | 7 | Reproduce 86,87 / 87,83 / 85,04; monotonía con la muestra; sin `NaN`; determinismo. |
| `core/racha3-test/racha3-test-score.calculator.spec.ts` | 24 | Cada gate, cada nivel, el empate exacto, evidencia nula, la traza. |
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

1. **El umbral se derivó del mismo histórico sobre el que se mide.** Es fuga de
   información **a nivel de diseño**, y el walk-forward no la corrige: corrige
   la fuga en el cálculo de la tasa, no en la elección del umbral. Por eso 86,87
   es un valor experimental inicial.
2. **El backtest excluye las oportunidades con
   `bloqueada_por_operacion_previa`** (50 de 4.102). Al filtrar, el hueco de
   «una operación a la vez» quedaría libre en momentos en que históricamente
   estaba ocupado, y ahí podrían haberse tomado algunas de esas. El backtest no
   las recupera. El sesgo existe, es conocido y no se estima.
3. **`z = 2,30` no es un resultado establecido.** Con 2,67 pp de diferencia
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

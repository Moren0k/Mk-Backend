# Arquitectura del Motor de Análisis BacBo

> **Versión:** 1.0
>
> **Arquitectura objetivo:** Motor de procesamiento de eventos en tiempo real, completamente desacoplado y extensible.

---

# 1. Objetivo

El proyecto consiste en desarrollar un backend independiente encargado de analizar en tiempo real las jugadas generadas por el backend del juego BacBo.

El sistema **no modifica el juego**, únicamente consume su información mediante **Server-Sent Events (SSE)** y ejecuta estrategias de análisis.

Cuando una estrategia detecta una oportunidad de apuesta, se crea una **Operation** que administrará todo el ciclo de vida de dicha señal hasta finalizar (ganada o perdida).

Las notificaciones se enviarán mediante Telegram, aunque la arquitectura permitirá agregar nuevos canales sin modificar la lógica del negocio.

---

# 2. Filosofía

Este proyecto **NO es un CRUD**.

Este proyecto **NO es una API REST tradicional**.

Este proyecto es un **motor de procesamiento de eventos (Event Processing Engine)**.

Todo gira alrededor de un único evento:

```
Nueva jugada recibida
```

Cada vez que llega una jugada, el sistema reacciona.

Nunca consulta continuamente el historial para buscar cambios.

El flujo siempre comienza con un nuevo evento.

---

# 3. Principios arquitectónicos

Durante todo el desarrollo se seguirán estos principios.

## Responsabilidad única (SRP)

Cada componente debe tener una única responsabilidad.

Ejemplos:

- obtener datos
- almacenar memoria
- detectar estrategias
- administrar operaciones
- enviar notificaciones

Nunca una clase hará dos responsabilidades.

---

## Desacoplamiento

Ningún módulo debe conocer detalles internos de otro.

Por ejemplo:

La estrategia no conoce Telegram.

Telegram no conoce las estrategias.

El historial no conoce las operaciones.

Las operaciones no conocen SSE.

---

## Arquitectura dirigida por eventos

Todo el sistema funciona reaccionando a eventos.

Ejemplo:

```
Nueva jugada

↓

Actualizar historial

↓

Evaluar estrategias

↓

Actualizar operaciones

↓

Generar eventos

↓

Notificar
```

Nunca existirá una lógica central llena de condiciones.

---

## Extensibilidad

Agregar una nueva estrategia nunca debe requerir modificar el núcleo del sistema.

Debe bastar con crear una nueva clase.

---

# 4. Flujo general

```
                 Backend BacBo
                      │
                      │
                    SSE
                      │
                      ▼
          GameEventCollector
                      │
                      ▼
          HistoryRepository
       (Ring Buffer de 200 partidas)
                      │
                      ▼
        StrategyCoordinator
                      │
          Notifica la nueva jugada
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
 Streak3Strategy            FutureStrategy
        │                           │
        ▼                           ▼
 ¿Debe abrir operación?     ¿Debe abrir operación?
        │
        ▼
 Crear Operation
        │
        ▼
 OperationOpenedEvent
        │
        ▼
 NotificationService
        │
        ▼
 Telegram

──────────────────────────────────────────────

Cada nueva jugada también actualiza todas las
operaciones abiertas.

                      │
                      ▼
         OperationCoordinator
                      │
                      ▼
      Actualizar operaciones activas
                      │
                      ▼
        ¿Cambió algún estado?
                      │
                      ▼
             Domain Events
                      │
                      ▼
         NotificationService
                      │
                      ▼
                 Telegram
```

---

# 5. Componentes

## 5.1 GameEventCollector

Responsabilidad:

Consumir el SSE del backend del juego.

Funciones:

- conectarse
- reconectarse automáticamente
- validar eventos
- transformar DTOs
- entregar la nueva jugada

Nunca:

- analiza
- guarda historial
- envía Telegram

---

## 5.2 HistoryRepository

Es el corazón de la memoria.

Responsabilidades:

- mantener las últimas 200 partidas
- eliminar automáticamente la más antigua
- evitar duplicados
- ofrecer consultas

Ejemplo:

```
[1]

[2]

...

[199]

[200]
```

Llega una nueva:

```
sale [1]

entra [201]
```

Siempre existen exactamente 200 partidas.

Internamente utilizará un **Ring Buffer**.

---

## ¿Por qué guardar 200?

Porque el backend del juego ya expone un máximo de 200 partidas.

Además:

- futuras estrategias pueden necesitar más historial
- estadísticas pueden usar ventanas grandes
- backtesting será más sencillo

Las estrategias no deciden cuánto historial existe.

Ellas únicamente consultan el necesario.

---

# 5.3 StrategyCoordinator

Su responsabilidad es extremadamente simple.

Cuando llega una nueva jugada:

```
for strategy in strategies

↓

strategy.onNewGame(game)
```

No analiza.

No toma decisiones.

No conoce reglas.

Únicamente distribuye la nueva jugada.

---

# 5.4 Estrategias

Las estrategias representan únicamente la lógica para detectar oportunidades.

Ejemplo:

```
PLAYER

PLAYER

PLAYER
```

↓

Abrir operación.

Después de eso, la estrategia termina.

No administra la apuesta.

No calcula martingalas.

No envía Telegram.

No hace seguimiento.

Su única responsabilidad es responder:

```
¿Debo abrir una operación?
```

---

## Ejemplo

```
PPP

↓

Sí

↓

Crear Operation
```

Fin.

---

# 5.5 Operation

Este es el verdadero corazón del dominio.

Una Operation representa una apuesta iniciada por una estrategia.

Una vez creada, tiene vida propia.

La estrategia ya no participa.

---

## Ciclo de vida

```
OPEN

↓

WAITING

↓

MG1

↓

WAITING

↓

MG2

↓

WAITING

↓

WIN

o

LOSE
```

---

## La Operation conoce

- estrategia que la creó
- apuesta esperada
- martingala actual
- estado
- historial interno
- resultado

---

## La Operation NO conoce

Telegram

SSE

HistoryRepository

NestJS

Fastify

---

# 5.6 OperationCoordinator

Administra todas las operaciones abiertas.

Cada nueva jugada:

```
for operation

↓

operation.update(game)
```

Nada más.

No toma decisiones.

No construye mensajes.

No conoce Telegram.

---

# 6. Eventos de dominio

La arquitectura gira alrededor de eventos.

Una operación puede generar:

```
OperationOpenedEvent

MartingaleOneReachedEvent

MartingaleTwoReachedEvent

OperationWonEvent

OperationLostEvent
```

Cada transición genera exactamente un evento.

---

# 7. NotificationService

Escucha los eventos anteriores.

Convierte un evento del dominio en un mensaje.

Ejemplo:

```
OperationWonEvent

↓

Plantilla Telegram

↓

Mensaje

↓

Telegram
```

---

La lógica del mensaje nunca estará dentro de la estrategia.

---

# 8. Ciclo de vida de una estrategia

Supongamos:

```
PLAYER

PLAYER

PLAYER
```

La estrategia detecta la condición.

↓

Crea una Operation.

↓

OperationOpenedEvent.

↓

Telegram envía la señal.

La estrategia termina aquí.

---

Nueva jugada:

```
PLAYER
```

La Operation recibe la jugada.

↓

MG1.

↓

MartingaleOneReachedEvent.

↓

Telegram.

---

Nueva jugada:

```
PLAYER
```

↓

MG2.

↓

Telegram.

---

Nueva jugada:

```
BANKER
```

↓

WIN.

↓

OperationWonEvent.

↓

Telegram.

↓

Operation finalizada.

---

# 9. Empates

Si durante una operación ocurre:

```
TIE
```

No aumenta martingala.

No gana.

No pierde.

La operación permanece esperando.

Ejemplo:

```
OPEN

↓

TIE

↓

OPEN
```

No cambia el estado.

---

# 10. Memoria

Existe una única memoria global.

```
HistoryRepository

↓

Ring Buffer

↓

200 partidas
```

Todas las estrategias consultan esta memoria.

Nunca la modifican.

---

Además cada Operation mantiene su propio estado.

Ejemplo:

```
Operation

↓

martingale = 1

↓

expectedWinner = BANKER

↓

status = MG1
```

---

# 11. Responsabilidades

## Collector

Obtiene información.

---

## HistoryRepository

Administra memoria.

---

## StrategyCoordinator

Distribuye jugadas.

---

## Strategy

Detecta oportunidades.

---

## OperationCoordinator

Actualiza operaciones.

---

## Operation

Administra el ciclo de vida.

---

## NotificationService

Convierte eventos en mensajes.

---

## TelegramService

Envía mensajes.

---

# 12. Estructura del proyecto

```
src/

├── core/
│
│   ├── history/
│   │
│   ├── strategy/
│   │   ├── strategies/
│   │   └── strategy.interface.ts
│   │
│   ├── operation/
│   │
│   ├── events/
│   │
│   ├── enums/
│   │
│   ├── interfaces/
│   │
│   ├── constants/
│   │
│   └── shared/
│
├── application/
│
│   ├── strategy/
│   │   └── strategy.coordinator.ts
│   │
│   ├── operation/
│   │   └── operation.coordinator.ts
│   │
│   └── notification/
│
├── infrastructure/
│
│   ├── sse/
│   │
│   ├── telegram/
│   │
│   ├── config/
│   │
│   └── nest/
│
└── main.ts
```

---

# 13. Reglas del proyecto

✅ Una clase = una responsabilidad.

✅ Un archivo = un concepto.

✅ Una estrategia = un archivo.

✅ Una operación = una entidad independiente.

✅ Telegram nunca es conocido por el dominio.

✅ Las estrategias nunca envían mensajes.

✅ El historial nunca conoce estrategias.

✅ Las operaciones nunca conocen SSE.

✅ Todo cambio importante genera un evento.

✅ Toda notificación nace de un evento del dominio.

---

# 14. Objetivo final

Construir un motor de análisis de eventos en tiempo real donde:

- nuevas estrategias puedan agregarse sin modificar el núcleo;
- múltiples canales de notificación puedan añadirse sin cambiar la lógica del negocio;
- el historial permanezca completamente desacoplado de las estrategias;
- cada operación tenga un ciclo de vida independiente;
- la arquitectura pueda evolucionar hacia múltiples mesas, múltiples juegos, persistencia, backtesting y escalabilidad sin necesidad de rediseñar el sistema desde cero.
  q

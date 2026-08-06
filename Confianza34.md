Sistema de Nivel de Confianza (v2)
Objetivo

El objetivo del nivel de confianza es decidir automáticamente qué estrategia utilizar según el rendimiento reciente del sistema.

El sistema no analiza porcentajes de acierto, Martingalas, ni estadísticas históricas. Solamente utiliza dos eventos:

✅ Operación ganada.
❌ Operación perdida.

La idea es que una buena racha aumente rápidamente la confianza y una mala racha la reduzca con fuerza.

Estados del sistema
100 ──────────────────────────────────────── 85
        Estrategia Agresiva
            (Racha de 3)

84 ───────────────────────────────────────── 55
      Estrategia Conservadora
            (Racha de 4)

54 ────────────────────────────────────────── 0
              STOP
         No se envían señales
Inicio

Cada vez que el sistema inicia:

Nivel de confianza = 85

Comienza directamente utilizando la estrategia agresiva (Racha de 3).

Cómo aumentan los puntos

Las ganancias consecutivas generan una recuperación progresiva.

Si una victoria rompe una racha de pérdidas, el contador vuelve a empezar.

Ganadas consecutivas	Puntos
Primera	+5
Segunda	+10
Tercera	+15
Cuarta o más	+20

Ejemplo

Gana
+5

Gana
+10

Gana
+15

Gana
+20

Gana
+20

Gana
+20

La bonificación máxima siempre será +20.

Cómo disminuyen los puntos

Las pérdidas consecutivas penalizan cada vez más.

Si una victoria rompe la racha de pérdidas, el contador vuelve a cero.

Pérdidas consecutivas	Puntos
Primera	−20
Segunda	−25
Tercera	−30
Cuarta o más	−30

Ejemplo

Pierde
-20

Pierde
-25

Pierde
-30

Pierde
-30

Pierde
-30

La penalización máxima siempre será −30.

Reinicio de contadores

Las rachas siempre se reinician cuando cambia el resultado.

Ejemplo

G G G P G G P P G

Se convierte en

+5
+10
+15

-20

+5
+10

-20
-25

+5

Nunca ocurre algo como:

+5
+10
+15
-20
+20

Porque la pérdida rompió la racha de victorias.

Cambio de estrategia
Estrategia Agresiva

Se utiliza cuando:

Nivel >= 85

Características:

Usa Racha de 3.
Genera más señales.
Mayor riesgo.
Mayor velocidad de recuperación.
Estrategia Conservadora

Se utiliza cuando:

55 <= Nivel <= 84

Características:

Usa Racha de 4.
Menos señales.
Mayor filtrado.
Menor riesgo.
STOP

Se activa cuando:

Nivel <= 54

Características:

No se envían señales.
El sistema espera a recuperar confianza.
Ejemplo completo

Inicio

Nivel = 85
Estado = Agresiva

Operaciones

Gana
+5

Nivel = 90

Estado = Agresiva
Gana
+10

Nivel = 100
Pierde
-20

Nivel = 80

Estado = Conservadora

La racha de victorias se rompe.

Nueva secuencia

Gana
+5

Nivel = 85

Estado = Agresiva

Nueva secuencia

Pierde
-20

Nivel = 65

Estado = Conservadora
Pierde
-25

Nivel = 40

Estado = STOP

Ahora el sistema deja de enviar señales.

Recuperación

Gana
+5

Nivel = 45
Gana
+10

Nivel = 55

Sale de STOP y vuelve a la estrategia Conservadora.

Gana
+15

Nivel = 70

Sigue en Conservadora.

Gana
+20

Nivel = 90

Regresa a la estrategia Agresiva.

Diagrama de funcionamiento
                   INICIO
                      │
                      ▼
            Nivel de confianza = 85
                      │
                      ▼
          ┌─────────────────────────┐
          │ Estrategia Agresiva     │
          │      Racha de 3         │
          │      (85 - 100)         │
          └──────────┬──────────────┘
                     │
        Pierde (-20/-25/-30)
                     │
                     ▼
          ┌─────────────────────────┐
          │ Estrategia Conservadora │
          │      Racha de 4         │
          │       (55 - 84)         │
          └──────────┬──────────────┘
                     │
        Pierde (-20/-25/-30)
                     │
                     ▼
          ┌─────────────────────────┐
          │          STOP           │
          │   No enviar señales     │
          │        (0 - 54)         │
          └──────────┬──────────────┘
                     │
       Gana (+5/+10/+15/+20)
                     │
                     ▼
          ┌─────────────────────────┐
          │ Estrategia Conservadora │
          └──────────┬──────────────┘
                     │
       Gana (+5/+10/+15/+20)
                     │
                     ▼
          ┌─────────────────────────┐
          │ Estrategia Agresiva     │
          └─────────────────────────┘
Observación importante

Hay un detalle que convendría añadir a la implementación: el nivel de confianza debe limitarse siempre al rango 0–100. Es decir:

Si una suma supera 100, se mantiene en 100.
Si una resta baja de 0, se mantiene en 0.

De esta forma el indicador permanece estable, fácil de interpretar y evita valores fuera del rango definido.
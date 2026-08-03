# Endpoint administrativo

`POST /admin/commands` es el único punto de entrada administrativo del
sistema. Está pensado para uso interno: pide una contraseña fija (definida
en `.env`) y un comando. Por ahora existe un único comando, `RESUMEN`, que
genera y envía por Telegram el resumen completo de todo lo ocurrido desde
que arrancó el proceso (sin límite de tiempo), y además lo devuelve en la
respuesta HTTP.

## 1. Configurar la contraseña

Agrega esta variable a tu `.env` local (nunca la subas al repositorio):

```
ADMIN_PASSWORD=una-contraseña-cualquiera
```

Se hashea (SHA-256) al arrancar el proceso y se compara siempre como hash,
nunca en texto plano. **Si `ADMIN_PASSWORD` no está definida, el endpoint
rechaza cualquier solicitud con `401` (falla cerrado).**

## 2. Levantar el servidor

```bash
pnpm start:dev
```

Por defecto escucha en `http://localhost:3000` (o el puerto que hayas
puesto en `PORT`).

## 3. Probar el endpoint

### Con curl (Git Bash / WSL / macOS / Linux)

```bash
curl -X POST http://localhost:3000/admin/commands \
  -H "Content-Type: application/json" \
  -d '{"password":"una-contraseña-cualquiera","command":"RESUMEN"}'
```

### Con PowerShell

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/admin/commands" `
  -ContentType "application/json" `
  -Body (@{ password = "una-contraseña-cualquiera"; command = "RESUMEN" } | ConvertTo-Json)
```

### Respuesta esperada (200 OK)

```json
{
  "ok": true,
  "command": "RESUMEN",
  "dispatchedAt": "2026-08-03T05:24:07.608Z",
  "metrics": {
    "alertsSent": 12,
    "closedOperations": 10,
    "won": 8,
    "lost": 2,
    "effectivenessPct": 80,
    "directWins": 5,
    "martingaleOneWins": 2,
    "martingaleTwoWins": 1,
    "martingalesExhausted": 1,
    "distribution": {
      "directPct": 50,
      "martingaleOnePct": 20,
      "martingaleTwoPct": 10,
      "lostPct": 20
    },
    "uptimeMs": 7384521,
    "bestWinStreak": 4,
    "worstLossStreak": 1,
    "currentStreak": { "result": "WON", "length": 3 },
    "totalMartingalesUsed": 6,
    "avgMartingalesPerWin": 0.5,
    "directWinPctOfWins": 62.5,
    "martingaleOneWinPctOfWins": 25,
    "martingaleTwoWinPctOfWins": 12.5,
    "winLossRatio": 4,
    "alertsPerHourAvg": 5.85,
    "avgEffectivenessPerHour": 78.5,
    "bestAlertsHour": { "label": "02/08 22:00", "value": 5 },
    "bestEffectivenessHour": { "label": "02/08 22:00", "value": 100 },
    "worstEffectivenessHour": { "label": "03/08 11:00", "value": 33.33 }
  }
}
```

Si tienes `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` configurados, este mismo
comando también envía el mensaje "dashboard" al chat de Telegram.

## 4. Casos de error, para probar que la seguridad funciona

| Escenario                              | Body                                     | Respuesta esperada         |
| -------------------------------------- | ---------------------------------------- | -------------------------- |
| Sin `password`                         | `{"command":"RESUMEN"}`                  | `401 Unauthorized`         |
| `password` incorrecta                  | `{"password":"mal","command":"RESUMEN"}` | `401 Unauthorized`         |
| Comando desconocido                    | `{"password":"...","command":"OTRO"}`    | `400 Bad Request`          |
| `ADMIN_PASSWORD` no definida en `.env` | cualquiera                               | `401 Unauthorized` siempre |

```bash
# Sin password -> 401
curl -i -X POST http://localhost:3000/admin/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"RESUMEN"}'

# Password incorrecta -> 401
curl -i -X POST http://localhost:3000/admin/commands \
  -H "Content-Type: application/json" \
  -d '{"password":"mal","command":"RESUMEN"}'

# Comando inválido -> 400
curl -i -X POST http://localhost:3000/admin/commands \
  -H "Content-Type: application/json" \
  -d '{"password":"una-contraseña-cualquiera","command":"OTRO"}'
```

## Notas

- El historial que alimenta `RESUMEN` nunca se limpia ni tiene límite: si el
  bot lleva días corriendo, el resumen refleja todo ese tiempo.
- Este endpoint no afecta el reporte horario automático ni ninguna otra
  parte del motor — es un flujo aparte que solo lee el mismo historial.

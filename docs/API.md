# API (API Gateway HTTP API detrás de CloudFront en `/api/*`)

- Base pública: `https://<distribución>.cloudfront.net/api`. CloudFront reenvía `/api/*` al HTTP API y quita el prefijo con una CloudFront Function, o se configura la ruta `/api/...` en el API.
- JSON UTF-8. Errores: `{ "error": { "code": "VALIDATION_ERROR", "message": "texto legible en español", "details": [...] } }`.
- Validación con **zod**. Los schemas viven en `packages/core/src/schemas.ts` y se comparten con el frontend. Abajo van en JSON Schema.
- Throttling por defecto del stage: 5 rps, burst 10. `POST /replay`: 1 rps, burst 2 (route-level throttling).
- Nunca se devuelven teléfonos completos ni chat IDs.

---

## `POST /subscribers`: registrar

Request:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["channel", "location", "consent"],
  "additionalProperties": false,
  "properties": {
    "channel": { "enum": ["SMS", "TELEGRAM", "SIMULATED"] },
    "phone": { "type": "string", "pattern": "^\\+519\\d{8}$", "description": "Obligatorio si channel=SMS" },
    "role": { "enum": ["DIRECTOR", "DOCENTE", "FAMILIA", "OTRO"], "default": "FAMILIA" },
    "location": {
      "type": "object",
      "required": ["lat", "lon"],
      "properties": {
        "lat": { "type": "number", "minimum": -18.4, "maximum": 0.1 },
        "lon": { "type": "number", "minimum": -81.4, "maximum": -68.6 },
        "codMod": { "type": "string", "pattern": "^\\d{7}$" },
        "centroPoblado": { "type": "string", "maxLength": 80 },
        "distrito": { "type": "string", "maxLength": 80 },
        "departamento": { "type": "string", "maxLength": 40 }
      }
    },
    "minLevel": { "enum": [2, 3, 4], "default": 3 },
    "hazards": { "type": "array", "items": { "enum": ["HELADA","FRIAJE","LLUVIA","NEVADA","LLOVIZNA","CALOR","VIENTO"] }, "default": ["HELADA","FRIAJE","LLUVIA","NEVADA"] },
    "consent": { "const": true },
    "website": { "type": "string", "maxLength": 0, "description": "honeypot anti-bot, debe venir vacío" }
  }
}
```
El bbox de Perú es un prefiltro aproximado. Opcional: una validación fina con el polígono del país.

Respuestas:
- `201`: `{ "subscriberId": "01J9…", "status": "PENDING" | "ACTIVE", "next": { "type": "SMS_LINK" | "TELEGRAM_DEEPLINK" | "NONE", "telegramUrl": "https://t.me/AvisoAndinoBot?start=Q7M2PX" }, "phoneMasked": "+51 9•••••123" }`
- `409 ALREADY_REGISTERED` (mismo `phoneHash`): no revela más datos. Se reenvía el enlace de alta como máximo 1 vez cada 24 h.
- `422 SMS_NOT_AVAILABLE`: el número no está en la lista de verificados del sandbox, o se llegó al tope diario. El mensaje sugiere Telegram o SIMULADO.

## `DELETE /subscribers/{subscriberId}?code=XXXXXX`: baja
`code` = código de baja incluido en los mensajes (`/b/:code`). → `204`. Deja `status=OPTED_OUT` y borra `phoneEnc`.

## `GET /confirm/{code}`: ver el aviso a confirmar (no confirma)
`200`:
```json
{ "code": "K7P2QX", "alreadyConfirmed": false,
  "alert": { "title": "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR", "color": "NARANJA", "level": 3,
             "fechas": "30/09-01/10", "lugar": "CHARAMAYA", "tmin": -9, "hazard": "HELADA",
             "recommendations": ["Abrigue a los niños…"], "officialUrl": "https://www.senamhi.gob.pe/?p=aviso-meteorologico" } }
```
`404 NOT_FOUND` si el código no existe o expiró.

## `POST /confirm`: confirmar recepción
Request:
```json
{ "type": "object", "required": ["code"], "additionalProperties": false,
  "properties": { "code": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{6}$" },
                  "channel": { "enum": ["LINK", "SIMULATED"], "default": "LINK" } } }
```
`200`: `{ "confirmed": true, "confirmedAt": "2026-09-28T22:31:40Z", "firstTime": true }`. Es idempotente: una segunda llamada devuelve `firstTime: false`.

## `GET /alerts?active=true&limit=50&runId=LIVE`
`200`:
```json
{ "items": [
  { "avisoKey": "SENAMHI#2026#388", "nroAviso": 388, "year": 2026, "hazard": "HELADA",
    "title": "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
    "maxLevel": 3, "fechIni": "2026-09-30T05:00:00Z", "fechFin": "2026-10-03T04:59:59Z",
    "maps": [{ "mapa": 1, "geojsonUrl": "/api/alerts/SENAMHI%232026%23388%231/geometry" }],
    "firstSeenAt": "2026-09-28T22:15:03Z", "source": "SENAMHI_WFS",
    "deliveries": { "sent": 12, "confirmed": 7 } } ],
  "nextToken": null }
```

## `GET /alerts/{warningId}/geometry`
Devuelve GeoJSON **simplificado** (Turf `simplify`, tolerancia 0,01°) y cacheado por CloudFront 10 min, para pintarlo en el mapa.

## `GET /metrics?runId=LIVE`
`200`:
```json
{ "runId": "LIVE",
  "generatedAt": "2026-10-01T12:00:00Z",
  "totals": { "warningsIngested": 41, "alertsSent": 23, "delivered": 21, "failed": 1,
              "confirmed": 15, "confirmedPct": 65.2, "skipped": 310, "capped": 0 },
  "byChannel": { "SMS": { "sent": 6, "confirmed": 4 }, "TELEGRAM": { "sent": 9, "confirmed": 8 }, "SIMULATED": { "sent": 8, "confirmed": 3 } },
  "latency": { "detectToSendSec": { "p50": 5, "p90": 11, "n": 23 },
               "publicationToSendMin": { "p50": 312, "p90": 590, "note": "SENAMHI publica solo la fecha de emisión; cota superior" } },
  "sources": { "lastIngestOkAt": "2026-10-01T11:45:02Z", "lastSource": "SENAMHI_WFS", "fallbackUsedLast24h": false },
  "subscribers": { "active": 18, "byDepartment": { "PUNO": 7, "HUANCAVELICA": 5 } },
  "smsSpendUsdMonth": 1.40 }
```
Cache de CloudFront: 60 s.

## `POST /replay`: modo demo con un aviso histórico
Request:
```json
{ "type": "object", "required": ["year", "nroAviso"], "additionalProperties": false,
  "properties": { "year": { "type": "integer", "minimum": 2021, "maximum": 2026 },
                  "nroAviso": { "type": "integer", "minimum": 1, "maximum": 999 },
                  "mapa": { "type": "integer", "minimum": 1, "maximum": 3 },
                  "simulatedNow": { "type": "string", "format": "date-time" } } }
```
- Lista blanca configurable en SSM (`/aviso-andino/replay/allowlist`, p. ej. `["2026-230","2025-200","2026-388","2026-383"]`) para no convertir el endpoint en un proxy abierto del WFS.
- Siempre usa suscriptores `isDemo=true` y canal `SIMULATED`. **Nunca envía SMS reales.**
- `202`: `{ "runId": "R-01J9…", "status": "RUNNING", "pollUrl": "/api/metrics?runId=REPLAY%23R-01J9…" }`
- Resultado: `GET /metrics?runId=REPLAY#…` y `GET /replay/{runId}/deliveries` (lista de mensajes simulados para el "teléfono virtual").

## `POST /telegram/webhook`
- Header obligatorio `X-Telegram-Bot-Api-Secret-Token` == SSM `/aviso-andino/telegram/webhookSecret`; si no coincide → `401`.
- Body = `Update` de la Bot API (`https://core.telegram.org/bots/api#update`). Casos:
  - `/start <activationCode>` → vincula `telegramChatId` al suscriptor y lo activa.
  - texto `1` / `si` / `sí`, o `callback_query.data = "ack:<confirmCode>"` → confirma.
  - `/baja` → opt-out.
- Siempre responde `200` rápido, también ante errores lógicos, para que Telegram no reintente en bucle.

## Webhook de SMS entrante: **no aplica en Perú (por ahora)**
Con ruta compartida no llegan respuestas (RESEARCH.md §3). Queda preparado el handler `sms-events` para un futuro short code PE: el evento `TEXT_RECEIVED` / two-way por SNS con body `1` confirma y `STOP`/`BAJA` da de baja. Hoy ese mismo handler solo procesa los **eventos de estado** del Configuration Set (`TEXT_SUCCESSFUL`, `TEXT_DELIVERED`, `TEXT_UNREACHABLE`, `TEXT_CARRIER_UNREACHABLE`, `TEXT_BLOCKED`, …), que se correlacionan por `context.deliveryId`. SMS Voice v2 no define un evento `TEXT_FAILED`; los fallos llegan con los estados específicos documentados por el servicio.

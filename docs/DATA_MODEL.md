# Modelo de datos (DynamoDB on-demand)

Se usan **4 tablas** en lugar de single-table: con 4 días de plazo, es más fácil de entender para los agentes, los permisos IAM quedan por tabla (mínimo privilegio) y el volumen es mínimo. Todas llevan `PAY_PER_REQUEST`, `pointInTimeRecovery: true` (barato con tan pocos datos), `RemovalPolicy.RETAIN` salvo en stacks `dev`, y un atributo TTL `ttl` (epoch en segundos).

Nombres: `AvisoAndino-<stage>-<Tabla>` (el stage `prod` es el que se envía al hackathon).

## 1. `Subscribers`

| Clave | Tipo | Notas |
|---|---|---|
| **PK** `subscriberId` | S | ULID (`01J9…`), ordenable por tiempo |

GSIs:
- `byPhoneHash`: PK `phoneHash` (S), proyección KEYS_ONLY. Evita registros duplicados del mismo teléfono.
- `byTelegramChat`: PK `telegramChatId` (S), proyección ALL. Sirve para el webhook.
- `byStatus`: PK `status` (S), SK `createdAt` (S), proyección ALL. Lista los activos para el matcher.
  Con menos de unos miles de suscriptores basta un `Query status=ACTIVE`. Para escalar: GSI `byGeohash4` (PK geohash de 4 caracteres, ~20 km) y consultar las celdas que cubre el bbox del aviso.

Ejemplo:
```json
{
  "subscriberId": "01J9Z3V6M8Q2K4T7B1N5R0C9XD",
  "status": "ACTIVE",
  "channel": "SMS",
  "phoneHash": "hmac256:8f1c…e2",
  "phoneEnc": "kms:AQICAHh…",
  "phoneMasked": "+51 9•••••123",
  "telegramChatId": null,
  "role": "DIRECTOR",
  "lat": -15.984578, "lon": -70.503961,
  "codMod": "0226993", "centroPoblado": "CHARAMAYA", "distrito": "MAÑAZO", "departamento": "PUNO",
  "minLevel": 3,
  "hazards": ["HELADA", "FRIAJE", "LLUVIA", "NEVADA"],
  "isDemo": false,
  "consentAt": "2026-09-29T15:02:11Z", "consentVersion": "v1",
  "activationCode": "Q7M2PX",
  "createdAt": "2026-09-29T15:02:11Z", "lastConfirmedAt": "2026-09-30T13:10:00Z",
  "ttl": 1806710400
}
```

## 2. `Warnings`

| Clave | Tipo | Notas |
|---|---|---|
| **PK** `warningId` | S | `SENAMHI#2026#388#2` · `INDECI#PP24H#2026-09-28` · `REPLAY#<runId>#SENAMHI#2025#200#1` |

GSIs:
- `byActive`: PK `activeFlag` (S, `"1"` mientras esté vigente; se borra el atributo al vencer = índice disperso), SK `fechFin`. Alimenta `GET /alerts?active=true`.
- `byAviso`: PK `avisoKey` (`SENAMHI#2026#388`), SK `mapa` (N). Agrupa los días de un aviso.

Ejemplo:
```json
{
  "warningId": "SENAMHI#2026#388#2",
  "avisoKey": "SENAMHI#2026#388",
  "source": "SENAMHI_WFS",
  "year": 2026, "nroAviso": 388, "mapa": 2,
  "codFen": 7, "hazard": "HELADA",
  "title": "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
  "listLevelColor": "NARANJA",
  "fechaEmi": "2026-09-28", "fechIni": "2026-10-01T05:00:00Z", "fechFin": "2026-10-02T04:59:59Z",
  "levels": [1, 2, 3], "maxLevel": 3,
  "areas": [{ "level": 3, "bbox": [-75.9, -14.9, -73.8, -11.9] }],
  "s3Key": "snapshots/senamhi/2026/388_2/2026-09-28T22-15-03Z.geojson.gz",
  "contentHash": "sha256:4b0e…",
  "firstSeenAt": "2026-09-28T22:15:03Z", "updatedAt": "2026-09-28T22:15:03Z",
  "activeFlag": "1",
  "detailUrl": "https://www.senamhi.gob.pe/?p=aviso-meteorologico",
  "ttl": 1830000000
}
```
La geometría **no** se guarda en DynamoDB (límite de 400 KB por item). Va en S3 (`s3Key`). El matcher la lee de S3 y la cachea en memoria.

## 3. `Deliveries` (incluye la confirmación)

| Clave | Tipo | Notas |
|---|---|---|
| **PK** `deliveryId` | S | `${subscriberId}#${year}#${nroAviso}#L${level}`, determinista (idempotencia) |

GSIs:
- `byConfirmCode`: PK `confirmCode` (S), proyección ALL. Para `/c/:code`.
- `bySubscriber`: PK `subscriberId`, SK `createdAt`. Historial y tope diario.
- `byWarning`: PK `avisoKey`, SK `createdAt`. Dashboard por aviso.
- `byRun`: PK `runId` (`LIVE` o `REPLAY#<id>`), SK `createdAt`. Métricas por replay.

Ejemplo:
```json
{
  "deliveryId": "01J9Z3V6M8Q2K4T7B1N5R0C9XD#2026#388#L3",
  "subscriberId": "01J9Z3V6M8Q2K4T7B1N5R0C9XD",
  "avisoKey": "SENAMHI#2026#388", "warningIds": ["SENAMHI#2026#388#1", "SENAMHI#2026#388#2"],
  "runId": "LIVE",
  "level": 3, "hazard": "HELADA", "template": "HELADA", "rewrite": "FALLBACK_TEMPLATE",
  "channel": "SMS",
  "text": "SENAMHI NARANJA: heladas 30/09-01/10 en CHARAMAYA. Min prevista -9C. Abrigue a ninos y animales. Confirme: d1x.cloudfront.net/c/K7P2QX",
  "segments": 1, "encoding": "GSM7",
  "status": "DELIVERED",
  "statusHistory": [{"s":"PENDING","t":"2026-09-28T22:15:05Z"},{"s":"SENT","t":"2026-09-28T22:15:07Z"},{"s":"DELIVERED","t":"2026-09-28T22:15:19Z"}],
  "messageId": "a1b2c3…",
  "confirmCode": "K7P2QX",
  "createdAt": "2026-09-28T22:15:05Z", "sentAt": "2026-09-28T22:15:07Z",
  "latencyDetectToSendSec": 4,
  "confirmedAt": "2026-09-28T22:31:40Z", "confirmChannel": "LINK",
  "capped": false,
  "ttl": 1801785600
}
```
Estados: `PENDING → SENDING → SENT → DELIVERED | FAILED`, además de `SKIPPED` (con `skipReason`) y `SCHEDULED` (horario de silencio). Las transiciones usan `ConditionExpression` sobre `status`.

## 4. `Stats` (contadores agregados que sobreviven al TTL)

| Clave | Tipo |
|---|---|
| **PK** `statsPk` | S: `GLOBAL`, `RUN#<runId>`, `DEPT#PUNO` |
| **SK** `statsSk` | S: `DAY#2026-09-30`, `TOTAL` |

Atributos numéricos que se actualizan con `UpdateItem ADD`: `sent`, `delivered`, `failed`, `confirmed`, `skipped`, `capped`, `latencySumSec`, `latencyCount`, `smsCostMicroUsd`. La mediana y el p90 de latencia se calculan en `GET /metrics` a partir de Deliveries de los últimos 30 días (pocos items); el total histórico sale de Stats.

## Patrones de acceso

| # | Patrón | Operación |
|---|---|---|
| A1 | Registrar suscriptor sin duplicar el teléfono | `Query byPhoneHash`, luego `PutItem` con `attribute_not_exists` |
| A2 | Activar por código | `Query` (GSI `byActivationCode` opcional) o el código incrustado en un token firmado (HMAC), sin GSI |
| A3 | Suscriptores activos para un aviso | `Query byStatus status=ACTIVE` + filtro de bbox en memoria |
| A4 | ¿Warning ya visto o cambiado? | `GetItem warningId` y comparar `contentHash` |
| A5 | Avisos vigentes (dashboard) | `Query byActive activeFlag="1"` |
| A6 | Crear delivery sin duplicar | `PutItem` con `attribute_not_exists(deliveryId)` |
| A7 | ¿Ya se envió un nivel menor de este aviso? (escalamiento) | `GetItem` en `…#L2` y `…#L3` (claves deterministas) |
| A8 | Tope diario por suscriptor | `Query bySubscriber` con `createdAt >= hoy 00:00 Lima`, `Select COUNT` |
| A9 | Confirmar por enlace | `Query byConfirmCode`, luego `UpdateItem` con `attribute_not_exists(confirmedAt)` y `ADD Stats.confirmed` |
| A10 | Confirmar por Telegram | `Query byTelegramChat` → `Query bySubscriber` (desc, límite 5) → la primera sin confirmar de < 72 h |
| A11 | Métricas globales | `GetItem Stats GLOBAL/TOTAL` + `Query byRun runId=LIVE` (últimos 30 días) |
| A12 | Métricas de un replay | `Query byRun runId=REPLAY#id` + `GetItem Stats RUN#id/TOTAL` |
| A13 | Estado de entrega (evento SMS) | `Query` por `messageId` → mejor guardar `deliveryId` en `Context` del `SendTextMessage` para que vuelva en el evento y hacer `UpdateItem` directo |
| A14 | Baja | `UpdateItem status=OPTED_OUT`, borrar `phoneEnc` (minimización) |

## Retención (TTL)
- Subscribers demo (`isDemo`): 14 días. Reales: 180 días desde `lastConfirmedAt`.
- Deliveries: 30 días. Warnings: 90 días. Stats: sin TTL (no contiene datos personales).
- S3 snapshots: lifecycle de 30 días, salvo los avisos de la lista blanca de replay (prefijo `replay/`, sin expirar).

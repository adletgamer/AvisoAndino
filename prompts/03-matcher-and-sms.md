# Prompt 03: Reglas, matcher y envío (Claude Code; Codex puede hacer la parte de core en paralelo)

---
Contexto: **Aviso Andino**. Lee `AGENTS.md`, **`docs/RULES.md` (fuente de verdad)**, `docs/DATA_MODEL.md` y `docs/RESEARCH.md` §2–§4 (Open-Meteo, límites de SMS a Perú, Bedrock).

Hechos clave: SMS a Perú = USD 0,23252/mensaje. Sandbox = USD 1/mes y solo números verificados. Perú no admite sender ID ni long code → enviar **sin origination identity** (ruta compartida). **No llegan respuestas** → la confirmación va por enlace `/c/:code` o por Telegram.

## Parte A: `packages/core` (puro, 100 % testeado)
1. `gsm7.ts`: `sanitizeToGsm7(s)` (quita tildes de á í ó ú Á Í Ó Ú, mantiene ñ/Ñ, normaliza comillas y guiones, elimina emojis), `isGsm7(s)`, `segments(s)`.
2. `geo.ts`: `effectiveLevel([lon,lat], areas)`: prefiltro bbox + `@turf/boolean-point-in-polygon`, devuelve el nivel máximo (1 si no hay match).
3. `rules.ts`: `decide({subscriber, warningGroup (mapas del mismo aviso), alreadySent: {levels:number[]}, sentToday, globalSentToday, now, config}) → Decision` con `{send:boolean, level, template, fechas, reason, scheduleAt?, channelOverride?}` implementando **todos** los puntos de RULES.md §2 (vigencia, umbral, agregación por aviso, escalamiento, silencio, topes, EXTENSION_SUPPRESS, cod_fen desconocido).
4. `templates.ts`: plantillas exactas de RULES.md §3 + `render(templateId, vars)`, que falla si el resultado no es GSM-7 o pasa de 160. `formatFechas(fechIni, fechFin)` en hora Lima.
5. `rewriteValidator.ts`: los 6 checks de RULES.md §4.
6. Tests: casos 1–19 de la tabla de RULES.md con los fixtures reales (`fixtures/senamhi-wfs-aviso.*`). Añade un test que recorra **todas** las plantillas con los valores del peor caso.

## Parte B: `services/matcher`
- Entrada SQS `{warningId}`. Carga todos los mapas del mismo `avisoKey` (GSI `byAviso`) y sus geometrías desde S3 (caché en memoria por `s3Key`).
- Suscriptores `ACTIVE` (GSI `byStatus`; en replay solo `isDemo=true`). Para cada uno → `decide()`.
- Si `send`: `PutItem Deliveries` con `attribute_not_exists(deliveryId)` (`ConditionalCheckFailed` = ya enviado, OK), `confirmCode` único (Crockford base32 de 6 caracteres, reintenta si colisiona), `status=PENDING` (o `SCHEDULED` con `scheduleAt`) → SQS send-queue (`DelaySeconds` si aplica, máximo 900; para más, EventBridge Scheduler one-time **o** simplificar: guardar `SCHEDULED` y que `ingest` los reencole en cada corrida si `scheduleAt <= now`).
- Si no: contar en Stats `skipped` (sin crear delivery, salvo modo debug).
- **Open-Meteo** (solo si `hazard=HELADA`): agrupar puntos por celda de 0,1°, una llamada `https://api.open-meteo.com/v1/forecast?latitude=a,b,c&longitude=x,y,z&daily=temperature_2m_min&timezone=America%2FLima&forecast_days=3`, caché de 3 h en memoria o en DynamoDB. `tmin` = mínimo en los días del aviso. Si falla → plantilla `HELADA_SIN_TMIN`. Atribución CC-BY en la web.

## Parte C: `services/sender`
- Entrada SQS `{deliveryId}`. Transición condicional `PENDING→SENDING` (si falla, ya lo tomó otro → OK).
- Lee los flags de SSM (caché de 60 s): `SMS_ENABLED`, `REWRITE_ENABLED`, `SMS_DAILY_CAP`, `SMS_MAX_PRICE` y `sms/allowlist` (lista de phoneHash permitidos mientras dure el sandbox).
- Texto: plantilla de core. Si `REWRITE_ENABLED` → Bedrock Converse `us.amazon.nova-micro-v1:0` (timeout 3 s, `maxTokens` 120, `temperature` 0.2) → `rewriteValidator`. Si falla → plantilla. Caché de la reescritura por `avisoKey#template#COLOR#fechas`.
- Canales:
  - **SMS**: `SendTextMessageCommand` (`@aws-sdk/client-pinpoint-sms-voice-v2`) con `DestinationPhoneNumber` (descifrado), `MessageBody`, `MessageType: 'TRANSACTIONAL'`, `ConfigurationSetName`, `MaxPrice`, `Context: {deliveryId}` y **sin** `OriginationIdentity`. Si `SMS_ENABLED=false` o el número no está en la allowlist → degradar a SIMULATED con `reason`.
  - **TELEGRAM**: `POST https://api.telegram.org/bot<token>/sendMessage` con `reply_markup.inline_keyboard=[[{text:"1 ✅ Recibí", callback_data:"ack:<code>"}]]` y texto largo.
  - **SIMULATED**: solo guarda el texto.
- Actualiza Delivery (`SENT`, `sentAt`, `messageId`, `segments`, `encoding`, `latencyDetectToSendSec`) y Stats (`ADD sent`, `smsCostMicroUsd += 232520`).
- Errores de throttling o transitorios → throw (SQS reintenta, DLQ tras 3). Errores permanentes (número inválido) → `FAILED` sin reintento.

## Parte D: `services/sms-events`
- SNS → parsea el evento del Configuration Set (`TEXT_SUCCESSFUL`, `TEXT_DELIVERED`, `TEXT_FAILED`, `TEXT_BLOCKED`, …). Correlaciona por `context.deliveryId` y actualiza status + Stats. Loguea el evento completo una vez (sin teléfono) para descubrir el formato real y documentarlo en RESEARCH.md.

## Criterios de aceptación
- Casos 1–19 de RULES.md en verde. Cobertura de `packages/core` ≥ 90 %.
- En prod: con `SMS_ENABLED=true` y el número de la humana en la allowlist, **un aviso vigente real (o un replay con `allowSms=true` solo para su número) produce exactamente 1 SMS real** con el texto esperado (1 segmento). Reprocesar el mismo mensaje SQS no envía otro.
- Con `SMS_ENABLED=false` todo sigue funcionando por SIMULATED.
- Captura del SMS recibido guardada para el video (la hace la humana).

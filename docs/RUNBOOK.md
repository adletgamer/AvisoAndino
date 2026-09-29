# Runbook operativo

Este runbook cubre incidentes del piloto de Aviso Andino. Producción vive en
`us-east-1`. Inspeccionar y cambiar recursos preferentemente mediante Agent
Toolkit for AWS / AWS MCP para conservar evidencia en CloudTrail.

## Principios de respuesta

1. Proteger a las personas: ninguna recuperación debe enviar SMS duplicados.
2. Ante duda, poner `/aviso-andino/prod/SMS_ENABLED=false`; el flujo continúa
   como `SIMULATED`.
3. No borrar tablas, buckets, colas ni la stack de producción.
4. No pegar teléfonos, chat IDs, tokens, payloads descifrados ni account IDs en
   tickets o logs. Buscar por `subscriberId`, `warningId` o `deliveryId`.
5. Antes de reinyectar una DLQ, corregir la causa y probar con un solo mensaje.

## WFS de SENAMHI caído

Síntomas:

- métrica `FetchErrors` creciente;
- logs `error_wfs`;
- alarma de ingestión o ausencia de warnings nuevos.

Acciones:

1. Comprobar desde Agent Toolkit que la Lambda `ingest` fue invocada y revisar
   sus logs estructurados.
2. Consultar una vez la lista SENAMHI y una URL WFS conocida. No crear un bucle
   de peticiones.
3. Confirmar la métrica/log `fallback_indeci`. El fallback INDECI solo cubre
   precipitación PP24H; no sustituye heladas, friaje o nevada.
4. Mantener el Scheduler activo si INDECI responde. Si ambas fuentes fallan,
   pausar el Scheduler para evitar ruido y conservar las alarmas activas.
5. Al recuperarse, invocar `ingest` una vez. Verificar un snapshot S3 y luego
   una segunda invocación idempotente (`WarningsNew=0`,
   `WarningsChanged=0`).

No fabricar avisos ni usar Open-Meteo para dispararlos.

## Cambió el HTML de la lista SENAMHI

Síntomas:

- error `No se encontró la tabla #table_id`;
- dos corridas consecutivas con cero avisos activos;
- fallback INDECI aunque la web pública muestra avisos.

Acciones:

1. Guardar la respuesta cruda fuera del repositorio si contiene contenido no
   revisado.
2. Compararla con
   `fixtures/senamhi-avisos-list.*.trimmed.html`: tabla `#table_id`, siete
   columnas y estados `emitido`/`vigente`.
3. Ajustar `services/ingest/src/senamhiList.ts` con un fixture nuevo y tests.
   No inferir campos que no aparezcan en la fuente.
4. Ejecutar:

   ```bash
   ./scripts/fetch-fixtures.sh 388 2026
   pnpm --filter @aviso/svc-ingest test
   pnpm test
   ```

5. Desplegar solo después de lint, tests, synth y revisión del diff de CDK.

## Hay mensajes en una DLQ

1. Identificar si es `match-dlq` o `send-dlq` y anotar `warningId` o
   `deliveryId`, nunca el teléfono.
2. Revisar los tres intentos y clasificar:
   - transitorio: throttling, timeout, error 5xx;
   - permanente: payload inválido, número inválido, permisos/configuración;
   - bug de código.
3. Para `send-dlq`, consultar primero el estado de Delivery:
   - `SENT`/`DELIVERED`: eliminar el mensaje de DLQ; no reinyectar;
   - `SENDING`: investigar el `messageId` antes de decidir;
   - `PENDING`: puede reintentarse tras corregir la causa;
   - `FAILED`: solo reintentar si se corrigió una clasificación incorrecta.
4. Redrive de un solo mensaje y verificar. Después redrive gradual del resto.
5. Confirmar que la DLQ vuelve a cero y que no aumentan
   `DeliveriesFailed` ni el gasto SMS.

La clave determinista de Delivery y la transición condicional evitan
reprocesamientos normales, pero no justifican un redrive masivo sin revisar.

## Se alcanzó o se acerca el gasto de SMS

1. Cambiar inmediatamente
   `/aviso-andino/prod/SMS_ENABLED` a `false` en SSM.
2. Verificar que el parámetro quedó en `false` y esperar 60 segundos por la
   caché del sender.
3. Ejecutar una entrega controlada y comprobar:
   `channel=SIMULATED`, `simulatedReason=SMS_DISABLED` y cero llamadas
   `SendTextMessage`.
4. Revisar `smsSent`, `smsCostMicroUsd`, Budget y cuota mensual del sandbox.
5. No subir `SMS_DAILY_CAP`, `SMS_MAX_PRICE` ni la cuota sin aprobación humana.
6. Para reactivar: confirmar Budget y allowlist, habilitar un único número
   verificado, poner `SMS_ENABLED=true` y observar una sola entrega.

Precio de referencia documentado: USD 0,23252 por segmento a Perú.

## Rotar el token de Telegram

1. Crear/revocar el token con BotFather; nunca copiarlo al chat del agente.
2. Reemplazar el SecureString
   `/aviso-andino/prod/telegram/botToken` mediante consola o herramienta AWS
   segura.
3. Rotar también
   `/aviso-andino/prod/telegram/webhookSecret`.
4. Volver a registrar el webhook con el secret nuevo.
5. Esperar 60 segundos por cachés y probar `/start`, el botón
   `1 ✅ Recibí` y `/baja`.
6. Confirmar que un webhook con el secret anterior devuelve `401`.

## Pausar o reanudar el Scheduler

Usar el recurso EventBridge Scheduler de la stack `AvisoAndino-prod`.

Para pausar:

1. poner el Schedule en estado `DISABLED`;
2. verificar que no haya una ejecución de `ingest` en curso;
3. mantener alarmas y colas activas;
4. registrar motivo y hora UTC.

Para reanudar:

1. resolver la causa;
2. invocar `ingest` manualmente una vez;
3. comprobar warnings/snapshots y una segunda ejecución idempotente;
4. poner el Schedule en `ENABLED`;
5. verificar una invocación exitosa dentro del siguiente intervalo.

`SCHEDULE_ENABLED` representa la configuración deseada de la stack; el estado
real del Schedule debe comprobarse después de cualquier cambio.

## Verificación posterior

- Lambdas sin errores nuevos durante dos intervalos de ingesta.
- DLQs vacías.
- `SMS_ENABLED` en el valor esperado.
- Última fuente y hora de ingesta visibles en métricas.
- Ningún teléfono completo o chat ID en logs.
- Budget y alarmas en estado normal.
- Incidente documentado con IDs técnicos, causa, corrección y tests añadidos.

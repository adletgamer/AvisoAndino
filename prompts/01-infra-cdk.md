# Prompt 01: Infraestructura CDK (Claude Code recomendado)

---
Contexto: proyecto **Aviso Andino** (lee `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md` y `docs/STACK.md`). Región `us-east-1`. CDK v2 TypeScript en `infra/`. Una stack `AvisoAndino-<stage>` (stage por contexto `-c stage=dev|prod`, default `dev`).

## Recursos a crear (`infra/lib/aviso-andino-stack.ts`)
1. **DynamoDB** (PAY_PER_REQUEST, PITR, TTL `ttl`, RETAIN en prod y DESTROY en dev): `Subscribers` (GSIs `byPhoneHash`, `byTelegramChat`, `byStatus`), `Warnings` (`byActive`, `byAviso`), `Deliveries` (`byConfirmCode`, `bySubscriber`, `byWarning`, `byRun`) y `Stats` (PK `statsPk`, SK `statsSk`). Claves exactas en DATA_MODEL.md.
2. **S3** `snapshots` (privado, SSE-S3, `enforceSSL`, lifecycle de 30 días salvo el prefijo `replay/`) y `web` (privado, servido por CloudFront con OAC).
3. **SQS** `match-queue` y `send-queue`, cada una con DLQ (`maxReceiveCount` 3, retención de 14 días), visibility timeout ≥ 6× el timeout de la Lambda consumidora.
4. **Lambdas** `NodejsFunction` (runtime `NODEJS_24_X`, arm64, logs JSON, retención de 14 días, env vars con nombres de tablas y colas). Para que esbuild resuelva el monorepo pnpm, usa el `pnpm-lock.yaml` raíz mediante `depsLockFilePath: path.join(process.cwd(), '..', 'pnpm-lock.yaml')`:
   - `ingest` (60 s, 512 MB) ← **EventBridge Scheduler** `rate(15 minutes)` (L2 `aws-cdk-lib/aws-scheduler` `Schedule` + `aws-cdk-lib/aws-scheduler-targets` `LambdaInvoke`). Con un flag `SCHEDULE_ENABLED` se puede pausar.
   - `matcher` (60 s, 512 MB) ← SQS match-queue (batch 1, `reportBatchItemFailures`).
   - `sender` (30 s, 256 MB, `reservedConcurrentExecutions: 2`) ← SQS send-queue.
   - `api` (10 s, 256 MB) ← HTTP API.
   - `sms-events` (10 s) ← SNS topic `sms-events`.
5. **HTTP API** (apigatewayv2) con las rutas de API.md, throttling por defecto (5 rps / burst 10) y más estricto en `POST /replay`.
6. **CloudFront**: origen S3 (default, SPA fallback a `index.html` para 403/404) + behavior `/api/*` → HTTP API (CachePolicy disabled salvo `GET /api/metrics` y `/api/alerts*` con 60 s). `BucketDeployment` desde `apps/web/dist` (si existe; si no, un `index.html` placeholder "Aviso Andino, pronto").
7. **End User Messaging SMS** (L1 `aws-cdk-lib/aws-smsvoice`: `CfnConfigurationSet`, `CfnProtectConfiguration`, `CfnOptOutList`; verificados en aws-cdk-lib 2.271.0): ConfigurationSet `aviso-andino` con event destination → SNS `sms-events`. `CfnProtectConfiguration` con solo PE permitido para SMS (revisa en la documentación de CloudFormation cómo se expresa la lista de países; si no puedes resolverlo en 20 min, documéntalo como paso manual en `docs/DECISIONS.md`).
8. **SSM parameters** (String, sin secretos): `/aviso-andino/<stage>/SMS_ENABLED=false`, `REWRITE_ENABLED=false`, `SMS_DAILY_CAP=30`, `SMS_MAX_PRICE=0.30`, `replay/allowlist=["2026-230","2025-200","2026-388","2026-383"]`, `sms/allowlist=[]`. **Los SecureString (token de Telegram, webhook secret, HMAC key) los crea la humana a mano**; la stack solo referencia sus nombres y da `ssm:GetParameter` + `kms:Decrypt` (clave `aws/ssm`) a las Lambdas que los usan.
9. **IAM de mínimo privilegio** con `grant*`: ingest (Warnings RW, snapshots put, match-queue send), matcher (Subscribers R, Warnings R, Deliveries RW, Stats RW, send-queue send, snapshots get), sender (Deliveries RW, Stats RW, `sms-voice:SendTextMessage` sobre el ARN del configuration set y `phone-number/*` o `pool/*` según corresponda, `bedrock:InvokeModel` sobre `arn:aws:bedrock:us-east-1:<acct>:inference-profile/us.amazon.nova-micro-v1:0` y `arn:aws:bedrock:{us-east-1,us-east-2,us-west-2}::foundation-model/amazon.nova-micro-v1:0`, SSM get), api (según rutas, más `lambda:InvokeFunction` de ingest para replay), sms-events (Deliveries/Stats RW).
10. **Observabilidad**: alarmas (errores > 0 en 5 min para cada Lambda, DLQ visibles > 0, ingest sin invocaciones exitosas en 60 min) → SNS `alarms` con suscripción de email por contexto `-c alarmEmail=`. **AWS Budget** (`aws-budgets` CfnBudget) de USD 10 al mes con notificaciones al 50/80/100 %.
11. **Tags**: `project=aviso-andino`, `stage`, `hackathon=zero-to-shipped`.
12. **Outputs**: `WebUrl`, `ApiUrl`, nombres de tablas y colas, `ConfigurationSetName`.
13. `infra/test/stack.test.ts`: assertions (4 tablas con TTL, 5 Lambdas `nodejs24.x` arm64, 2 DLQs, ninguna policy con `Action: "*"`, un Budget y el Scheduler presente).
14. (Recomendado) `cdk-nag` AwsSolutions con supresiones justificadas.

## Deploy
- `pnpm lint && pnpm test && pnpm synth` en verde. Muestra `pnpm diff -- -c stage=prod` y **espera mi OK**.
- Despliega **usando el AWS MCP Server / Agent Toolkit** (o la CLI desde el agente conectado). Si hace falta, `cdk bootstrap aws://<acct>/us-east-1` antes.
- Tras el deploy, verifica vía MCP: `cloudformation describe-stacks`, `curl WebUrl` (200) e invocación manual de `ingest`.

## Criterios de aceptación
- Stack desplegada en prod. `WebUrl` público responde 200. Scheduler activo.
- Test de la stack en verde. Sin `*` en IAM salvo donde AWS lo exige, justificado en un comentario.
- `docs/DECISIONS.md` actualizado con cualquier desviación.
- Resumen final con Outputs y los comandos MCP usados (sirven de prueba para el hackathon).

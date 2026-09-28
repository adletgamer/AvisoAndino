# AGENTS.md: reglas para agentes de código (Claude Code, Codex, Cursor, Kiro…)

Proyecto: **Aviso Andino**. Convierte avisos oficiales de SENAMHI en SMS claros (≤160 GSM-7) para colegios rurales del Perú. Hackathon AWS Builder Center "Zero to Shipped". Deadline: 2-oct-2026 23:59 PDT.
Lee primero: `docs/RULES.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md`, `docs/RESEARCH.md` (datos verificados de las fuentes y límites de SMS).

## Reglas NO negociables
1. **Un LLM nunca decide una alerta.** Quién, cuándo, nivel y geometría salen solo de `packages/core` (código determinista con tests). Bedrock solo reescribe texto detrás de `REWRITE_ENABLED` y su salida pasa por `rewriteValidator`. Si el validador falla → plantilla.
2. **Nunca commitear secretos** (tokens de Telegram, claves, account IDs en código, `.env`). Los secretos van en SSM Parameter Store SecureString bajo `/aviso-andino/<stage>/…`. `.env.example` solo lleva nombres. Si ves un secreto en el diff, detente y avisa.
3. **Nunca enviar SMS reales desde tests, replay o scripts de seed.** Los tests mockean los clientes AWS (`aws-sdk-client-mock`). El replay usa siempre `SIMULATED`. El envío real exige `SMS_ENABLED=true` en SSM **y** que el número esté en la allowlist mientras la cuenta siga en sandbox.
4. **Test antes de deploy**: `npm run lint && npm test && npm run synth` en verde antes de cualquier `cdk deploy`. Nunca `--require-approval never` sobre cambios de IAM sin mostrar el diff (`npm run diff`) a la humana.
5. **Guardarraíles de costo**: nada con costo fijo por hora (NAT Gateway, RDS, OpenSearch, instancias EC2, WAF, Kinesis) sin permiso explícito. Lambdas arm64, DynamoDB on-demand y logs con retención de 14 días. Los topes `SMS_DAILY_CAP` y `MaxPrice` no se quitan. Recordatorio: 1 SMS a Perú = **USD 0,23252** y el sandbox permite USD 1/mes.
6. **Solo fuentes oficiales para alertar**: SENAMHI WFS (primaria) e INDECI GeoSINPAD (fallback). Open-Meteo solo enriquece (Tmin), nunca dispara.
7. **Privacidad**: jamás loguear teléfonos completos ni chat IDs (usar `maskPhone`). No usar los campos `DIRECTOR`, `TELEFONO` y `EMAIL` de la capa MINEDU para contactar a nadie.
8. **No destruir `prod`** (`cdk destroy`, borrar tablas o buckets) sin confirmación explícita. La URL debe vivir hasta la semana del 5-oct.
9. **No inventar APIs ni campos.** Si dudas de un campo de SENAMHI/INDECI, mira `fixtures/` o haz una petición real y actualiza `docs/RESEARCH.md`.

## Convenciones
- TypeScript estricto (`strict: true`, sin `any` implícito), ESM, Node 24. Import de `@aviso/core` desde services y web.
- Handlers delgados: parsean la entrada, llaman a `core` y hacen I/O. La lógica vive en `packages/core` (pura y sin AWS SDK).
- Nombres de código en inglés; textos al usuario, logs de negocio y docs en español.
- Fechas en ISO UTC en los datos; en UI y SMS, hora Lima (`America/Lima`).
- Coordenadas **[lon, lat]** (GeoJSON). Niveles como número 1–4 (1 = verde = no es aviso).
- IDs: ULID para entidades y claves deterministas para idempotencia (ver DATA_MODEL.md).
- Logs: Powertools Logger en JSON con `warningId`, `deliveryId` y `subscriberId`.
- Commits pequeños (`feat(core): …`, `fix(ingest): …`). Un PR o tarea por prompt de `prompts/`.

## Comandos
```bash
npm ci                      # instalar (workspaces)
npm run lint                # eslint + tsc --noEmit
npm test                    # vitest en todos los workspaces (offline, con fixtures)
RUN_LIVE=1 npm test -w services/ingest   # tests contra SENAMHI/INDECI reales (opcional)
npm run synth               # cdk synth (stage=dev por defecto)
npm run diff -- -c stage=prod
npm run deploy -- -c stage=prod          # SOLO tras tests en verde; preferir ejecutarlo vía AWS MCP / Agent Toolkit
npm run dev -w apps/web     # frontend local (usa VITE_API_BASE)
npm run seed:demo -- --stage prod        # suscriptores demo SIMULATED
./scripts/fetch-fixtures.sh # refrescar fixtures reales
```

## Conexión con AWS
- Usa el **Agent Toolkit for AWS** (plugin `aws-core` / AWS MCP Server `https://aws-mcp.us-east-1.api.aws/mcp`) para desplegar, inspeccionar recursos, leer logs e invocar funciones. Esas llamadas quedan en CloudTrail y son la **prueba** que exige el hackathon.
- Región: `us-east-1`. Perfil: el que configuró la humana. **No pidas ni leas claves de acceso.**
- Antes de un deploy, muestra qué cambia (`cdk diff`) y espera confirmación si hay cambios de IAM, de datos o de costo.

## Definición de terminado (por tarea)
- Tests nuevos o actualizados en verde. Criterios de aceptación del prompt cumplidos. Docs afectados actualizados (RULES/API/DATA_MODEL). Sin secretos. `npm run synth` OK. Si se desplegó: URL o comando de verificación y resultado pegados en el resumen.

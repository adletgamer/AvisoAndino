# Stack elegido (y por qué)

## Resumen
| Capa | Elección | Versión fijada (registro de paquetes, 28-sep-2026) |
|---|---|---|
| Lenguaje | **TypeScript** en todo el repo (infra, Lambdas, web, core) | TS 5.x |
| Runtime Lambda | **`nodejs24.x`**, arm64 | Node 24 LTS (`nodejs20.x` quedó deprecado el 30-abr-2026) |
| IaC | **AWS CDK v2 (TypeScript)**, una app y una stack por stage | `aws-cdk-lib` 2.271.0, CLI `aws-cdk` 2.1143.0 |
| Bundling | `NodejsFunction` de CDK (esbuild) | esbuild 0.28.x |
| Geo | `@turf/boolean-point-in-polygon`, `@turf/bbox`, `@turf/simplify` | 7.4.0 |
| AWS SDK | v3 modular: `@aws-sdk/client-dynamodb` + `lib-dynamodb`, `client-pinpoint-sms-voice-v2`, `client-bedrock-runtime`, `client-sqs`, `client-s3`, `client-ssm` | 3.1142.x |
| Utilidades Lambda | Powertools for AWS Lambda (TS): Logger, Metrics, Idempotency (opcional) | 2.35.0 |
| Validación | **zod** (schemas compartidos por API y web) | 4.x |
| HTML parsing (lista SENAMHI) | `node-html-parser` (liviano) | – |
| Frontend | **Vite + React 19 + TypeScript + Leaflet (`react-leaflet`)** y teselas OSM con atribución | vite 8.3.x, react-leaflet 5.0.0, leaflet 1.9.4 |
| Estilos | CSS simple o Pico.css. Mobile-first y alto contraste (el público usa celulares básicos) | – |
| Tests | **Vitest** (unit y handlers con mocks), `aws-sdk-client-mock`, `msw` o fixtures locales para HTTP, y `cdk assert` con `Template.fromStack` | vitest 5.x |
| Calidad | ESLint (typescript-eslint) + Prettier, `tsc --noEmit` en CI | – |
| Monorepo | **pnpm workspaces**, sin Nx ni Turbo | pnpm 12.6.0 (Corepack) |
| CI (opcional) | GitHub Actions: lint + test + `cdk synth`. **El deploy lo hace el agente vía Agent Toolkit o la CLI** (es lo que evalúa el hackathon) | – |

## Por qué TypeScript/Node 24 y no Python 3.12
1. **Un solo lenguaje** para CDK, Lambdas, frontend y reglas: `packages/core` (plantillas, conteo GSM-7, reglas y schemas) se importa en la Lambda **y** en la web. La vista previa del SMS en el navegador usa exactamente el mismo código que produce el SMS real.
2. **Turf es JS puro**: no hay binarios. `shapely` necesita GEOS compilado (capa o contenedor), lo que añade fricción con 4 días de plazo.
3. Los agentes de código (Claude Code, Codex, Cursor) son muy buenos generando CDK en TS, y CDK TS es la variante mejor documentada.
4. Cold start de Node 24 arm64 con esbuild y tree-shaking: bajo y suficiente.

## Por qué S3 + CloudFront (vía CDK) y no Amplify Hosting
- **Todo en una stack CDK**: el agente despliega infra, API y web con un solo `cdk deploy` (`BucketDeployment`). Menos piezas y un ship gate más simple.
- El mismo dominio sirve `/api/*` (behavior al HTTP API) y `/c/:code`: **enlaces más cortos en el SMS** (cada carácter cuenta) y sin CORS.
- Amplify Hosting es una alternativa válida (CI desde Git y previews), pero añade una conexión a GitHub y un segundo pipeline.

## Por qué End User Messaging SMS (API v2) y no SNS `Publish` a teléfono
- `SendTextMessage` permite `ConfigurationSetName` (eventos de entrega), `MaxPrice`, `Context` (correlación `deliveryId`), `DryRun`, Protect Configurations (país PE en la lista de permitidos) y límites de gasto. SNS SMS usa la misma infraestructura con menos control.

## Layout del monorepo
```
aviso-andino/
├─ AGENTS.md                 # reglas para agentes (CLAUDE.md lo importa)
├─ CLAUDE.md
├─ README.md
├─ package.json              # workspaces + scripts raíz
├─ tsconfig.base.json
├─ .nvmrc                    # 24
├─ .env.example              # SOLO nombres de variables, nunca valores reales
├─ docs/                     # este kit
├─ prompts/                  # prompts de arranque 00..07
├─ fixtures/                 # respuestas reales recortadas (tests offline)
├─ packages/
│  └─ core/                  # lógica pura, SIN AWS SDK ni red
│     ├─ src/types.ts        # NormalizedWarning, Subscriber, Delivery…
│     ├─ src/levels.ts       # "Nivel 3" → 3, colores
│     ├─ src/hazards.ts      # cod_fen → Hazard
│     ├─ src/geo.ts          # bbox + point-in-polygon + nivel efectivo
│     ├─ src/rules.ts        # decide(subscriber, warningGroup, now) → Decision
│     ├─ src/templates.ts    # plantillas + render
│     ├─ src/gsm7.ts         # sanitize + isGsm7 + segments
│     ├─ src/rewriteValidator.ts
│     ├─ src/schemas.ts      # zod (API)
│     └─ test/*.test.ts
├─ services/                 # un directorio por Lambda (handler delgado → core)
│  ├─ ingest/src/handler.ts        # + senamhiList.ts, senamhiWfs.ts, indeci.ts
│  ├─ matcher/src/handler.ts       # + openMeteo.ts
│  ├─ sender/src/handler.ts        # + channels/sms.ts, telegram.ts, simulated.ts, bedrock.ts
│  ├─ api/src/handler.ts           # router mínimo (sin Express)
│  └─ sms-events/src/handler.ts
├─ infra/
│  ├─ bin/app.ts
│  ├─ lib/aviso-andino-stack.ts
│  └─ test/stack.test.ts
├─ apps/
│  └─ web/                   # Vite + React + Leaflet
└─ scripts/
   ├─ fetch-fixtures.sh      # vuelve a bajar fixtures reales
   ├─ seed-demo.ts           # crea suscriptores demo (colegios rurales reales, canal SIMULATED)
   └─ cloudtrail-proof.sh    # consulta de eventos del AWS MCP Server
```

## Qué NO usar (y por qué)
- **No usar un LLM para decidir alertas**, calcular niveles ni resolver geometría. Bedrock solo reescribe y siempre pasa por el validador.
- **No usar Amazon Location Service** para geocercas: Turf en memoria alcanza y es gratis. Location añade costo y configuración.
- **No usar Step Functions, EventBridge Pipes, Kinesis ni AppSync**: sobredimensionados para este volumen.
- **No usar RDS/Aurora/OpenSearch**: costo fijo. DynamoDB on-demand es prácticamente gratis aquí.
- **No usar Cognito** para el público: el registro es anónimo con consentimiento. Si hace falta un panel admin, basta una clave en SSM + header, o Cognito solo para admin si sobra tiempo.
- **No usar Amazon Pinpoint (legacy)**. Su parte de SMS es hoy AWS End User Messaging. Tampoco short codes ni WhatsApp esta semana (trámites de semanas).
- **No usar WAF** (≥ USD 5/mes más reglas): basta el throttling del HTTP API + honeypot + lista blanca de replay.
- **No usar KMS CMK** si se quiere costo 0: queda documentado como opción (~USD 1/mes) para `phoneEnc`.
- **No usar Next.js/SSR**: SPA estática es más simple de hospedar en S3.
- **No usar Python + shapely**, Express dentro de Lambda ni un ORM sobre DynamoDB.
- **No usar Lambda `nodejs20.x`** (deprecado) ni `python3.10` (deprecación 31-oct-2026).
- **No llamar al WFS de SENAMHI desde el navegador**: no tiene CORS y además no conviene golpearlo desde cada cliente.

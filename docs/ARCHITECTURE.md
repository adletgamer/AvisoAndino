# Arquitectura: Aviso Andino

> Principio rector: **ninguna IA decide quién recibe una alerta ni cuándo.** Eso lo deciden solo los avisos oficiales de SENAMHI y reglas deterministas con tests (ver `RULES.md`). Bedrock, si está activo, solo *reescribe* un texto que ya fue decidido, y su salida pasa por un validador que la descarta si inventa algo.

Imagen del diagrama principal: `docs/architecture.png` (fuente: `docs/architecture.mmd`).

## (a) Arquitectura del sistema

```mermaid
flowchart TB
  subgraph SRC["Fuentes oficiales y abiertas"]
    direction LR
    SL["SENAMHI<br/>lista de avisos"]
    WFS["SENAMHI WFS<br/>poligonos por aviso"]
    IND["INDECI GeoSINPAD<br/>fallback PP24H"]
    OM["Open-Meteo<br/>Tmin por punto"]
  end
  subgraph ING_G["1. Ingesta"]
    direction LR
    SCH["EventBridge Scheduler<br/>cada 15-30 min"] --> ING["Lambda ingest"]
    ING --> S3R[("S3<br/>snapshots crudos")]
  end
  subgraph DEC_G["2. Decision deterministica"]
    direction LR
    QM[["SQS match + DLQ"]] --> MAT["Lambda matcher<br/>punto en poligono + reglas + dedup"]
  end
  subgraph DEL_G["3. Entrega"]
    direction LR
    QS[["SQS send + DLQ"]] --> SND["Lambda sender<br/>plantilla GSM-7"]
    SND -. "opcional y validado" .-> BR["Bedrock Nova Micro<br/>solo reescribe"]
  end
  subgraph CH["Canales"]
    direction LR
    EUM["End User Messaging SMS<br/>solo ida en Peru"]
    TG["Telegram Bot<br/>two-way: responde 1"]
    SIM["Canal SIMULADO<br/>telefono virtual web"]
  end
  subgraph WEB["4. Web publica y API"]
    direction LR
    CF["CloudFront + S3<br/>registro, dashboard, replay, /c/codigo"] --> API["API Gateway HTTP API<br/>Lambda api"]
  end
  DDB[("DynamoDB<br/>Subscribers, Warnings,<br/>Deliveries, Stats")]
  OBS["CloudWatch logs + alarmas<br/>AWS Budgets, SSM"]
  U(("Director o familia"))

  SL --> ING
  WFS --> ING
  IND -.-> ING
  ING --> DDB
  ING --> QM
  OM --> MAT
  MAT --> DDB
  MAT --> QS
  SND --> EUM
  SND --> TG
  SND --> SIM
  SND --> DDB
  EUM --> U
  TG --> U
  U -->|"toca enlace de confirmacion"| CF
  TG -->|"webhook"| API
  API --> DDB
  DEL_G -.-> OBS
```

**Componentes (una sola stack CDK en `us-east-1`):**

| Componente | Servicio | Responsabilidad |
|---|---|---|
| `ingest` | Lambda (Node 24, arm64, 512 MB, 60 s) + EventBridge Scheduler (`rate(15 minutes)`, configurable) | Lee la lista de SENAMHI, detecta avisos nuevos o cambiados, descarga sus polígonos por WFS, normaliza, guarda un snapshot en S3 y el `Warning` en DynamoDB, y encola en `match-queue`. Fallback: INDECI capa 5. |
| `matcher` | Lambda (SQS `match-queue`, batch 1) | Para cada `Warning`: busca suscriptores candidatos (prefiltro bbox), aplica punto en polígono (Turf), reglas de nivel, fenómeno y horario, y dedup condicional. Crea `Delivery` y encola en `send-queue`. Enriquece con la Tmin de Open-Meteo (cacheada). |
| `sender` | Lambda (SQS `send-queue`, reserved concurrency 2) | Arma el mensaje con la plantilla GSM-7 (≤160). Opcional: reescritura con Bedrock + validador. Envía por SMS (End User Messaging), Telegram o SIMULADO y actualiza `Delivery`. |
| `sms-events` | Lambda (SNS desde el Configuration Set de End User Messaging) | Guarda los estados de entrega (`TEXT_DELIVERED`, `TEXT_UNREACHABLE`, `TEXT_CARRIER_BLOCKED`…) en `Delivery`. |
| `api` | API Gateway HTTP API + Lambda | `POST /subscribers`, `POST /confirm`, `GET /alerts`, `GET /metrics`, `POST /replay`, `POST /telegram/webhook`, `DELETE /subscribers/{id}` (baja). |
| web | S3 (privado, OAC) + CloudFront | SPA Vite+React+Leaflet: registro, dashboard, replay, página de confirmación `/c/:code`. CloudFront enruta `/api/*` al HTTP API (mismo dominio, sin CORS y con enlaces cortos). |
| datos | DynamoDB on-demand (4 tablas), S3 (snapshots, lifecycle de 30 días) | Ver `DATA_MODEL.md`. |
| operación | CloudWatch Logs (JSON), alarmas, AWS Budgets, SSM Parameter Store | Ver buenas prácticas. |

## (b) Flujo de ingesta y matching

```mermaid
flowchart TD
  A["Scheduler dispara ingest"] --> B["GET lista de avisos SENAMHI"]
  B -->|"falla o HTML cambió"| B2["Fallback: INDECI capa 5 f=geojson<br/>marcar source=INDECI"]
  B --> C["Filtrar filas con estado emitido o vigente"]
  C --> D{"Por cada nro_aviso y mapa 1..3"}
  D --> E["GET WFS viewparams=qry:nro_mapa_anio"]
  E --> F{"features > 0"}
  F -->|"no"| D
  F -->|"si"| G["Normalizar: cod_fen parseInt, nivel 1-4,<br/>fech_ini y fech_fin a ISO, hash de geometria"]
  G --> H["warningId = SENAMHI#anio#nro#mapa<br/>contentHash = sha256 de nivel, fechas y geometria"]
  H --> I{"Existe en Warnings con el mismo contentHash"}
  I -->|"si"| D
  I -->|"no o cambio"| J["PutItem Warnings + snapshot S3<br/>firstSeenAt = now si es nuevo"]
  J --> K["SendMessage match-queue"]
  K --> L["matcher: cargar poligonos Nivel 2-4"]
  L --> M["Suscriptores activos y confirmados<br/>prefiltro por bbox"]
  M --> N["booleanPointInPolygon por nivel<br/>nivel efectivo = maximo"]
  N --> O{"Reglas: fenomeno habilitado,<br/>nivel >= minLevel del suscriptor,<br/>vigencia no vencida"}
  O -->|"no"| P["Registrar skip con motivo"]
  O -->|"si"| Q["Put condicional Deliveries<br/>deliveryId = sub#anio#nro#nivel"]
  Q -->|"ConditionalCheckFailed"| R["Ya enviado: no duplicar"]
  Q -->|"ok"| S["Enriquecer con Tmin de Open-Meteo si es helada"]
  S --> T["SendMessage send-queue"]
```

## (c) Entrega y confirmación

```mermaid
sequenceDiagram
  autonumber
  participant Q as SQS send-queue
  participant S as Lambda sender
  participant B as Bedrock Nova Micro
  participant E as End User Messaging SMS
  participant T as Telegram Bot API
  participant P as Telefono del director
  participant W as CloudFront web /c/codigo
  participant A as API Lambda
  participant D as DynamoDB

  Q->>S: delivery pendiente
  S->>S: plantilla determinista GSM-7 de 160 caracteres o menos
  opt REWRITE_ENABLED=true
    S->>B: texto oficial + hechos obligatorios
    B-->>S: propuesta
    S->>S: validador: longitud, GSM-7, color, fechas, sin numeros nuevos
    Note over S: si falla se usa la plantilla
  end
  alt canal SMS
    S->>E: SendTextMessage PE, TRANSACTIONAL, MaxPrice, ConfigurationSet
    E-->>S: MessageId
    E-->>P: SMS por ruta compartida
    E->>A: evento TEXT_DELIVERED o FAILED via SNS a sms-events
  else canal Telegram
    S->>T: sendMessage con boton Recibido
    T-->>P: mensaje
  else canal SIMULADO
    S->>D: guarda el texto para el telefono virtual
  end
  S->>D: Delivery status SENT, sentAt, messageId
  alt SMS: el usuario toca el enlace
    P->>W: GET /c/K7P2QX
    W->>A: GET /api/confirm/K7P2QX muestra el aviso
    P->>W: toca Recibi el aviso
    W->>A: POST /api/confirm con code
  else Telegram: responde 1 o toca el boton
    P->>T: 1
    T->>A: POST /api/telegram/webhook con secret token
  end
  A->>D: UpdateItem confirmedAt si no existe
  A->>D: ADD Stats confirmed 1
```

## (d) Registro

```mermaid
flowchart TD
  A["Usuario abre la web"] --> B{"Como ubica su punto"}
  B -->|"Busca su colegio"| C["Consulta MINEDU ESCALE en GeoSINPAD<br/>por nombre o codigo modular"]
  B -->|"Pin en el mapa"| D["Leaflet: clic o GPS del navegador"]
  C --> E["lat, lon, centro poblado, distrito"]
  D --> E
  E --> F["Elige canal: SMS, Telegram o SIMULADO<br/>nivel minimo por defecto 3, fenomenos"]
  F --> G["Acepta consentimiento de datos personales Ley 29733"]
  G --> H["POST /api/subscribers"]
  H --> I{"Validacion zod: +51 9xxxxxxxx,<br/>punto dentro de Peru, rate limit"}
  I -->|"error"| J["400 con mensaje claro"]
  I -->|"ok"| K["Guardar: phoneHash HMAC, telefono cifrado,<br/>status PENDING, TTL"]
  K --> L{"canal"}
  L -->|"SMS"| M["SMS de bienvenida con enlace de alta<br/>solo a numeros verificados en sandbox"]
  L -->|"Telegram"| N["Deep link t.me/bot?start=token"]
  L -->|"SIMULADO"| O["Activo al instante, isDemo=true"]
  M --> P["Toca el enlace: status ACTIVE"]
  N --> P
```

## (e) Replay y demo

```mermaid
flowchart TD
  A["Juez abre Replay en la web"] --> B["Elige un aviso historico<br/>ej. 230/2026 heladas ROJO de junio o 388/2026"]
  B --> C["POST /api/replay con nro, anio y mapa"]
  C --> D{"Rate limit y lista blanca de avisos"}
  D --> E["Lambda api invoca ingest en modo replay<br/>o lee el snapshot S3 cacheado"]
  E --> F["Warning con replayRunId, sin tocar los datos reales"]
  F --> G["matcher contra suscriptores demo<br/>colegios rurales de ejemplo"]
  G --> H["Deliveries canal SIMULADO"]
  H --> I["Web: mapa con poligonos, lista de mensajes,<br/>telefono virtual y metricas del run"]
  I --> J["El juez toca Confirmar en el telefono virtual<br/>y el porcentaje de confirmados sube"]
```

## (f) Modelo de datos (ER)

```mermaid
erDiagram
  SUBSCRIBER ||--o{ DELIVERY : recibe
  WARNING ||--o{ DELIVERY : genera
  DELIVERY ||--o| CONFIRMATION : "se confirma (atributos en Delivery)"
  STATS }o--|| WARNING : agrega
  SUBSCRIBER {
    string subscriberId PK
    string phoneHash "GSI byPhoneHash"
    string phoneEnc
    string channel "SMS|TELEGRAM|SIMULATED"
    number lat
    number lon
    string centroPoblado
    string codMod
    number minLevel
    string status "PENDING|ACTIVE|OPTED_OUT"
    number ttl
  }
  WARNING {
    string warningId PK "SENAMHI#2026#388#2"
    string source
    number nroAviso
    number mapa
    number codFen
    number maxLevel
    string fechIni
    string fechFin
    string contentHash
    string firstSeenAt
    string s3Key
    string replayRunId
  }
  DELIVERY {
    string deliveryId PK "sub#2026#388#L3"
    string subscriberId "GSI bySubscriber"
    string warningKey
    number level
    string channel
    string status
    string confirmCode "GSI byConfirmCode"
    string sentAt
    string confirmedAt
    number ttl
  }
  CONFIRMATION {
    string confirmedAt
    string confirmChannel "LINK|TELEGRAM|SIMULATED"
  }
  STATS {
    string statsPk "GLOBAL o RUN#id"
    string statsSk "DAY#2026-09-30"
    number sent
    number confirmed
    number latencySumSec
  }
```

## Buenas prácticas AWS aplicadas (Well-Architected)

**Seguridad**
- **IAM de mínimo privilegio por Lambda**: `ingest` solo `PutItem/GetItem` en Warnings, `s3:PutObject` en su prefijo y `sqs:SendMessage` a match-queue. `matcher` lee Subscribers y Warnings y escribe Deliveries. `sender` puede `sms-voice:SendTextMessage` (limitado al ARN del configuration set), `bedrock:InvokeModel` (solo el perfil de Nova Micro y sus foundation-model) y `ssm:GetParameter` sobre `/aviso-andino/*`. `api` solo las acciones que necesita. Se usan los `grant*` de CDK, nunca `*`.
- **Secretos**: token del bot de Telegram, secreto del webhook y clave HMAC de teléfonos en **SSM Parameter Store SecureString** (gratis en tier estándar) o Secrets Manager (USD 0,40/secreto/mes). Nunca en el código ni en `cdk.json`. Se leen en el cold start y se cachean.
- **Privacidad de teléfonos** (Ley 29733 de Protección de Datos Personales):
  - `phoneHash = HMAC-SHA256(E.164, secreto)` para buscar y deduplicar. `phoneEnc` cifrado con KMS (CMK, ~USD 1/mes) o, si se decide no pagar la CMK, cifrado en reposo de DynamoDB y minimización.
  - Logs **enmascarados** (`+51 9•••••123`). La API pública nunca devuelve teléfonos.
  - **TTL**: suscriptores demo 14 días; reales 180 días desde la última confirmación, con aviso de renovación. Deliveries 30 días (las métricas agregadas quedan en Stats).
  - **Baja** en un clic con enlace (`/b/:code`), `/baja` en Telegram y `DELETE /subscribers/{id}`. STOP por SMS **no** es posible en Perú sin short code (ver RESEARCH.md §3); se documenta como limitación.
  - Consentimiento explícito (checkbox) con texto de finalidad y conservación.
- Webhook de Telegram validado con el header `X-Telegram-Bot-Api-Secret-Token`. S3 privado con OAC. HTTPS obligatorio. HTTP API con throttling (p. ej. 5 rps, burst 10) y `POST /replay` limitado a una lista blanca de avisos y solo canal SIMULADO.

**Fiabilidad**
- **Idempotencia**: `deliveryId` determinista + `PutItem` con `attribute_not_exists(deliveryId)`, así el mismo aviso nunca manda dos SMS al mismo suscriptor aunque SQS reentregue o ingest corra dos veces. El `sender` pasa `PENDING → SENDING` con una condición antes de llamar a la API de SMS (o usa Powertools Idempotency).
- **SQS con DLQ** (`maxReceiveCount: 3`), `reportBatchItemFailures` y alarma si la DLQ tiene más de 0 mensajes. Reintentos con backoff exponencial y jitter en las llamadas HTTP a SENAMHI/INDECI (timeout de 10 s).
- **Degradación**: si el WFS falla → INDECI. Si Bedrock falla o tarda más de 3 s → plantilla. Si Open-Meteo falla → plantilla sin Tmin. Si el HTML de la lista cambia → alarma "0 avisos parseados durante 6 h" + fallback INDECI.
- Snapshots crudos en S3 (auditoría y replay reproducible).

**Excelencia operativa**
- Logs JSON estructurados (Powertools Logger) con `warningId`, `deliveryId`, `subscriberId` y `correlationId`. Métricas EMF: `WarningsIngested`, `DeliveriesSent`, `DeliveriesFailed`, `RewriteFallback`, `LatencyDetectToSendSec`.
- **Alarmas CloudWatch** (10 gratis): errores de cada Lambda, DLQ > 0, `ingest` sin éxito en 1 h, `DeliveriesFailed` > 3/h y gasto SMS (métrica de End User Messaging, si existe; si no, contador propio × 0,23252).
- **AWS Budgets**: presupuesto mensual de USD 10 con alertas al 50 %, 80 % y 100 % por email (2 budgets gratis).
- X-Ray: **opcional** (`tracing: Active` en las Lambdas con un flag; el free tier incluye 100k trazas/mes).

**Costo**
- Todo serverless y on-demand. Lambdas arm64. EventBridge Scheduler (no un cron Lambda que se quede esperando). DynamoDB on-demand. CloudFront en lugar de un servidor. Sondeo configurable.
- **Límites de SMS por diseño**: gasto mensual de la cuenta (sandbox USD 1, subir a ~10–20), `MaxPrice` por mensaje, Protect Configuration que solo permite PE, tope de SMS por día y por suscriptor (máx. 3) y tope global diario (p. ej. 30). Al alcanzarlo se degrada a SIMULADO/Telegram y se registra.
- Bedrock: Nova Micro, `maxTokens` 120, solo si `REWRITE_ENABLED=true`, con caché por `warningId+plantilla` (misma reescritura para todos los suscriptores de un aviso, cambiando solo el lugar y el enlace).
- Open-Meteo: una llamada con varios puntos por lote, caché de 3 h por celda de 0,1° (muy por debajo de 10k/día).

**Región: `us-east-1` vs `sa-east-1`**

| | us-east-1 (elegida) | sa-east-1 (São Paulo) |
|---|---|---|
| Latencia a Lima | ~100–130 ms (irrelevante para un proceso batch y un SMS) | ~60–80 ms |
| Bedrock Nova Micro | Sí (perfil `us.`) | **[NO VERIFICADO]**; probablemente solo vía perfil cross-region |
| End User Messaging SMS | Sí | Sí **[verificar]** |
| Endpoint del AWS MCP Server | `aws-mcp.us-east-1.api.aws` | – |
| Precio | Más barato en general | ~20–50 % más caro en varios servicios |
| Residencia de datos | Fuera de Sudamérica | Más cerca (la Ley 29733 permite el flujo transfronterizo con garantías) |

Decisión: **us-east-1** por Bedrock, por el ecosistema del hackathon y por costo. Para producción con el Estado peruano convendría reevaluar sa-east-1.

# Verificación de fuentes y servicios (hecha el 28-sep-2026, ~17:10–17:30 hora Lima)

Todo lo de este documento se comprobó con peticiones reales desde un servidor (curl) o leyendo la documentación oficial ese mismo día. Lo que **no** se pudo verificar lo marco como **[NO VERIFICADO]**. Los fixtures que se mencionan están en `fixtures/`.

---

## 1. Avisos SENAMHI: hay DOS fuentes oficiales legibles por máquina

### 1A. INDECI GeoSINPAD (ArcGIS REST), la fuente propuesta al inicio

- Servicio: `https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer?f=json`
  (ArcGIS Server `currentVersion: 12`, SR nativo 102100/3857)
- Capas (`?f=json`):

| id | nombre | geometría | features hoy (28-sep) |
|---|---|---|---|
| 0 | EE_TT_CC (grupo) | – | – |
| 1 | SENAMHI (grupo) | – | – |
| 2 | `SDE.SENAMHI_AvisoActQuebrada24H` | Polygon | 14 (Paucartambo, Cusco; Nivel 2) |
| 3 | `SDE.SENAMHI_AvisoFWI24H` (índice de incendios) | Polygon | 0 |
| 4 | `SDE.SENAMHI_AvisoHidrologico24H` | Point (estaciones de ríos) | 8 (Loreto/Ucayali) |
| 5 | `SDE.SENAMHI_AvisoPP24H` (precipitación 24 h) | Polygon | 7 (Nivel 1, 2 y 3) |

- **Campos de la capa 5** (`/5?f=json`): `OBJECTID` (OID), `NIVEL` (string, p. ej. `"Nivel 3"`), `FECHA` (date, epoch ms; hoy `1790553600000` = 2026-09-28T00:00Z), `DESCRIPCIO` (string 254), `RECOMENDAC` (string 254), `RESPONS` (pronosticador), `FECHA_ETL` (date, **null** en todos), `SHAPE`, `SHAPE.AREA`, `SHAPE.LEN`.
  - **No tiene** `ID`, número de aviso, fenómeno ni vigencia inicio/fin. Solo sirve como "precipitación de las próximas 24 h".
  - Hallazgo de calidad de datos: en los 7 polígonos de la capa 5, `DESCRIPCIO` trae el texto de *activación de quebradas* ("Ante el pronóstico de lluvias es probable la activación de quebradas…"), igual que la capa 2. No hay que mostrar ese texto como si fuera la descripción de la lluvia.
- **Campos de la capa 2**: los de la capa 5 más `ID`, `GID` (null), `NOMBDEP`, `NOMBPROV`, `NOMBDIST`.
- **Campos de la capa 4** (puntos): `NOM_ESTACI`, `LONGITUD`, `LATITUD`, `FECHA_HORA` (string `"28-SEP-26"`), `NIVEL` (int), `COLOR_TEXT` (`AMARILLO`/`NARANJA`), `ID_AVISO`, `NUM_AVISO`, `TITULO`, `PELIGRO_NI`, `RECOMENDAC`, `URL_CENTRO`, `NOMBDEP/PROV/DIST`, `COD_CUENCA`, `NOM_CUENCA`…
- Consulta con geometría: `…/5/query?where=1%3D1&outFields=*&f=json&returnGeometry=true&outSR=4326` → `esriGeometryPolygon`, WKID 4326, 7 features, **3,6 MB** (el polígono de Nivel 1 tiene 49 443 vértices).
  - Con `&maxAllowableOffset=0.02&geometryPrecision=4` baja a unos 23 KB (fixture `indeci-layer5-avisopp24h.2026-09-28.simplified.json`).
  - `&f=geojson` también funciona y devuelve un `FeatureCollection` de tipo `Polygon` (fixture `.geojson`).
  - Punto en polígono del lado del servidor: `…/5/query?geometry=-69.5,-16.5&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&f=json` → `Nivel 3`. Sirve como oráculo en los tests.
  - `maxRecordCount` = 2000. `returnCountOnly=true` → `{"count":7}`.
- **Cadencia de actualización: [NO DESCUBRIBLE]**. No hay `editFieldsInfo` ni `timeInfo`, y `FECHA_ETL` viene null. `FECHA` es solo la fecha (00:00Z). Cabeceras: `Cache-Control: max-age=0,must-revalidate` y un `ETag`, que sirve para detectar cambios. Recomendación: guardar un snapshot en cada sondeo y medir la cadencia real.
- CORS: responde `Access-Control-Allow-Origin` reflejando el origen, así que el navegador puede consultarlo directamente.
- Otra capa útil del mismo servidor: **colegios de MINEDU (ESCALE)**, `https://geosinpad.indeci.gob.pe/indeci/rest/services/SIRAIM/SDE_IE_ESCALE_MINEDU/MapServer/0`. Son 180 828 registros; 63 562 cumplen `DAREACENSO='Rural' AND D_ESTADO='Activo'` y 37 002 son rurales en 10 departamentos altoandinos (Puno, Cusco, Huancavelica, Apurímac, Ayacucho, Pasco, Junín, Arequipa, Moquegua, Tacna; este último conteo no filtra por estado).
  Campos: `COD_MOD`, `CODLOCAL`, `CEN_EDU`, `D_NIV_MOD`, `CEN_POB`, `CODCP_INEI`, `D_DPTO/PROV/DIST`, `DAREACENSO`, `NLAT_IE`, `NLONG_IE`, `D_ESTADO`… **Nota de privacidad:** también trae `DIRECTOR`, `TELEFONO` y `EMAIL`. **No** hay que usarlos para escribir a nadie (no hay consentimiento, Ley 29733). La capa solo sirve para que el usuario busque *su* colegio y coloque el pin.

### 1B. SENAMHI GeoServer WFS (`idesep.senamhi.gob.pe`): la fuente primaria recomendada

La encontré dentro de la página del mapa de avisos (`https://www.senamhi.gob.pe/mapas/mapa-avisos-meteorologicos/index.php?av=388&nl=3&mp=2&fc=2026`), en el enlace "Descargar Shapefile".

- GetCapabilities: `https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetCapabilities`
  - Capas: `g_aviso:view_aviso` ("AVISO METEOROLÓGICO NACIONAL") y `g_aviso:view_aviso_aux` (lista de departamentos/provincias afectadas).
- DescribeFeatureType `view_aviso`: `gid` (long), `nro_aviso` (int), `nro_mapa` (int = día del aviso, 1..3), `nivel` (string `"Nivel 1".."Nivel 4"`), `fecha_emi` (date), `cod_fen` (string), `cod_even` (string), `fech_ini` (dateTime), `fech_fin` (dateTime), `cod_sede`, `respons`, `pub` (int), `cap` (int), `geom` (MultiPolygon).
- **Una petición = un aviso y un día**, con el parámetro `viewparams=qry:{nro}_{mapa}_{año}`:
  `https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=g_aviso:view_aviso&viewparams=qry:388_2_2026&outputFormat=application/json`
  → GeoJSON EPSG:4326 con 4 MultiPolygon (Nivel 1, 1, 2, 3), 2,3 MB. Sin `viewparams` devuelve 0 features.
  - Ejemplo del aviso 388 ("DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR", NARANJA): `fecha_emi 2026-09-28Z`, mapa 1 `fech_ini 2026-09-30T05:00:00Z` → `fech_fin 2026-10-01T04:59:59Z` (00:00–23:59 hora Lima), mapas 2 y 3 los días siguientes.
- **Punto en polígono del lado del servidor** (probado): añadir `&CQL_FILTER=INTERSECTS(geom,POINT(-70.02 -15.84))&propertyName=gid,nro_aviso,nivel,fech_ini,fech_fin,cod_fen` → Puno ciudad = `Nivel 2` (fixture `senamhi-wfs-point-query.388_2_2026.puno.json`).
- **Historial disponible** (sirve para el modo replay): `qry:200_1_2025` (cod_fen 7, 15-jun-2025), `qry:150_1_2025`, `qry:180_1_2026`… todos responden.
  - **Aviso 230/2026** ("DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR", **ROJO**, emitido el 11-jun-2026): mapas 1 y 2 con Nivel 1–4. El Nivel 4 cae en la zona alta de Cusco/Arequipa (bbox −72.96,−16.17 a −70.99,−14.13). Colegio rural 40383 (Huambo, Caylloma) = Nivel 3 en `230_1`. Es el mejor candidato para el replay de la demo.
  - En la lista hay 136 avisos NARANJA/ROJO de heladas o friaje en 2025–2026.
- **Códigos `cod_fen` inferidos** comparando con los títulos de la lista del 28-sep. **[INFERIDO, no hay tabla oficial publicada]**:

| cod_fen | título observado |
|---|---|
| 1 / "01" | PRECIPITACIONES EN LA COSTA NORTE Y SIERRA (383) |
| 2 | LLUVIA EN LA SELVA – UNDÉCIMO FRIAJE (387) |
| 3 | LLOVIZNA EN LA COSTA CENTRO Y SUR (382) |
| 4 | NEVADA EN LA SIERRA SUR (384) |
| 5 | INCREMENTO DE TEMPERATURA DIURNA (380, 385) |
| 7 | DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA (388, 230) → **heladas**, **y también** DESCENSO DE TEMPERATURA DIURNA EN LA SELVA – CUARTO FRIAJE (247). **cod_fen 7 = "descenso de temperatura"**: hay que mirar el título ("NOCTURNA" → helada; "DIURNA"/"FRIAJE" → friaje) |
| 10 | INCREMENTO DE VIENTO (381, 386) |

  Ojo: `cod_fen` llega a veces como `"1"` y a veces como `"01"`. Hay que normalizarlo con `parseInt`.
- **Niveles** (leyenda oficial de la página del mapa): **Nivel 1 = "No es necesario tomar precauciones especiales"** (verde, *no es aviso*), Nivel 2 = AMARILLO, Nivel 3 = NARANJA, Nivel 4 = ROJO. En la misma respuesta los polígonos pueden solaparse: nos quedamos con el **nivel máximo** que contiene al punto.
- **Lista de avisos** (para saber qué números consultar): `https://www.senamhi.gob.pe/?p=aviso-meteorologico`. Es una tabla HTML (`#table_id`) de unas 2 067 filas desde 2021, con columnas Aviso (título), Nro. (`"388 (emitido)"`, `"384 (vigente)"`), Emisión, Inicio, Fin, Duración y Nivel (`AMARILLO/NARANJA/ROJO`). El HTML de la página de detalle (`?p=aviso-meteorologico-detalle&a=2026&b=<id>&c=00&d=SENA`) trae el texto oficial completo y los enlaces a los mapas (`av=388&nl=3&mp=2`). Fixture: `senamhi-avisos-list.2026-09-28.trimmed.html`.
- CORS: el WFS **no** devuelve `Access-Control-Allow-Origin`, así que hay que consultarlo desde Lambda.
- En la web de SENAMHI aparece un modal "Producto experimental en etapa de evaluación", pero no está claro a qué producto se refiere. **Riesgo:** el WFS no es una API con SLA. Por eso el diseño trae fallback a INDECI y snapshots en S3.

## 2. Open-Meteo

- Pronóstico (se aceptan varios puntos en una sola llamada):
  `https://api.open-meteo.com/v1/forecast?latitude=-15.84,-12.79&longitude=-70.02,-74.97&daily=temperature_2m_min&timezone=America%2FLima&forecast_days=3`
  → devuelve un array con un objeto por punto, cada uno con `elevation`, `daily.time[]` y `daily.temperature_2m_min[]` en °C. El 28-sep: Puno (3817 m) 3,9 / 5,2 / 2,9 °C; Huancavelica (3727 m) 0,0 / 1,2 / −2,4 °C.
- Elevación: `https://api.open-meteo.com/v1/elevation?latitude=-15.84,-12.79&longitude=-70.02,-74.97` → `{"elevation":[3817.0, 3727.0]}`
- Términos (`https://open-meteo.com/en/terms`): la API gratuita es **solo para uso no comercial**, con menos de 10 000 llamadas/día, 5 000/hora, 600/minuto y 300 000/mes, bajo licencia **CC-BY 4.0** (hay que citar "Weather data by Open-Meteo.com").
- Uso en Aviso Andino: **solo enriquece** el mensaje (añade "mín. prevista −8 °C en su punto") y el dashboard. **Nunca dispara una alerta por sí solo** (ver RULES.md).

## 3. SMS a Perú con AWS End User Messaging SMS: la restricción más importante

Fuente: `https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-sms-by-country.html`

| Perú (PE, +51) | |
|---|---|
| Short codes | **Sí** |
| Long codes | **No** |
| Sender IDs | **No** |
| Two-way SMS | **Sí, pero solo con short code dedicado** (los sender IDs no admiten two-way; "Before you can use two-way SMS… obtain either a dedicated short code or a dedicated long code") |
| International sending | Sí (best effort) |

- **Short code para Perú**: no aparece entre los países que se pueden pedir desde la consola (CL, FI, DE, IN, NL, ES, GB, US). Hay que abrir un caso de Soporte (`https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-request-short-code.html`). El plazo **[NO VERIFICADO]** suele ser de semanas. **Es inviable antes del 2-oct.**
- **Sin identidad de origen dedicada**: "you can start sending without obtaining an origination ID… In countries that don't support Sender IDs, your messages are sent from a random long code or short code" (`https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-number-types.html`). **Así que se puede enviar a Perú, pero las respuestas no nos llegan.**
- **Sandbox** (`https://docs.aws.amazon.com/sms-voice/latest/userguide/sandbox.html`): **límite de gasto de USD 1,00 al mes**, envío **solo a números destino verificados** (máximo 10) y el primer código de verificación por número es gratis. La salida a producción se pide con un caso de Soporte (Service Quotas → "SMS Production Access") y la primera respuesta llega en 24 h.
- **Precio** (JSON oficial que usa la página de precios, `https://s3.amazonaws.com/aws-messaging-pricing-information/TextMessageOutbound/prices.json`): **PE saliente = USD 0,23252 por mensaje** (transaccional y promocional, "All Networks"). Entrante: USD 0,009. **Con el sandbox, USD 1 alcanza para unos 4 SMS.** Un mensaje con tildes pasa a UCS-2 (70 caracteres por segmento) y se cobra por segmento, de ahí la regla GSM-7 de RULES.md.
- **Simuladores**: la lista de destinos simulador (`https://docs.aws.amazon.com/sms-voice/latest/userguide/test-phone-numbers.html`) **no incluye Perú** (sí incluye US, CL…).
- **Recibos de entrega (DELIVERED) desde operadores peruanos por ruta compartida: [NO VERIFICADO].**

### Decisión: ruta realista para la demo
1. **SMS de ida (real)** al número peruano verificado de Alejandra (y hasta 9 más), sin origination identity (ruta compartida), con `MaxPrice` y una Protect Configuration que solo permita PE. **Hoy mismo**: pedir producción y subir el gasto mensual a unos USD 10–20.
2. **La confirmación no se hace respondiendo "1" por SMS** (no se puede en Perú sin short code). Se hace con un **enlace corto dentro del SMS** (`https://<cloudfront>/c/K7P2QX`): la página muestra el aviso y un botón "Recibí el aviso" (POST). Así no confirman solos los bots que generan previsualizaciones de enlaces.
3. **Canal two-way real para jueces: bot de Telegram** (gratis, sin sandbox). El usuario responde `1` o pulsa un botón inline. Aquí sí se demuestra la respuesta "1".
4. **Canal "SIMULADO"** en la web: un "teléfono virtual" que muestra el SMS exacto que se habría enviado. Lo usan el replay y los jueces fuera de Perú.
5. Email con SES: opcional. En sandbox SES solo envía a direcciones verificadas y hasta 200/día (`https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html`), así que no sirve para el público.
6. Futuro: short code peruano (two-way con "1" y STOP) o WhatsApp vía AWS End User Messaging Social. Los dos requieren trámites que no caben en 4 días.

## 4. Bedrock (reescritura corta en español)

- Amazon Nova Micro: model ID `amazon.nova-micro-v1:0`, perfil de inferencia US `us.amazon.nova-micro-v1:0`; desde us-east-1 enruta a us-east-1/us-east-2/us-west-2 (`https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html`). Solo texto y muy barato.
- Amazon Nova Lite: `amazon.nova-lite-v1:0` / `us.amazon.nova-lite-v1:0` (`https://docs.aws.amazon.com/nova/latest/userguide/what-is-nova.html`).
- IAM: `bedrock:InvokeModel` sobre el ARN del inference profile **y** sobre los foundation-model de las 3 regiones destino (re:Post, `https://repost.aws/knowledge-center/bedrock-access-denied-exception`).
- Precio exacto por token: **[NO VERIFICADO]**. Es del orden de fracciones de centavo por mensaje; revisar la página de precios de Bedrock.

## 5. Librerías y runtimes

- `npm view` (28-sep): `@turf/boolean-point-in-polygon` 7.4.0 (Polygon y MultiPolygon con huecos, opción `ignoreBoundary`), `@turf/bbox` 7.x, `aws-cdk-lib` 2.271.0, `aws-cdk` (CLI) 2.1143.0, `@aws-sdk/client-pinpoint-sms-voice-v2` 3.1142.0, `@aws-sdk/client-bedrock-runtime` 3.1142.0, `@aws-sdk/lib-dynamodb` 3.1142.0, `@aws-lambda-powertools/logger|idempotency` 2.35.0, `vite` 8.3.1, `react-leaflet` 5.0.0, `leaflet` 1.9.4, `maplibre-gl` 6.11.2, `vitest` 5.0.2, `zod` 4.6.5, `esbuild` 0.28.2.
- En Python: `shapely` necesita binarios GEOS (capa o contenedor). Turf es JS puro. Por eso elegimos TypeScript.
- Runtimes de Lambda (`https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html`): **`nodejs20.x` quedó deprecado el 30-abr-2026**. Usar **`nodejs24.x`** (deprecación 30-abr-2028). `python3.12` también está soportado.

## 6. Agent Toolkit for AWS y prueba en CloudTrail

- Repositorio: `https://github.com/aws/agent-toolkit-for-aws` (README: `aws configure agent-toolkit`; Claude Code `/plugin install aws-core@claude-plugins-official`; Codex `codex plugin marketplace add aws/agent-toolkit-for-aws`; Cursor: Team Marketplace importando `aws/agent-toolkit-for-aws`; endpoint MCP `https://aws-mcp.us-east-1.api.aws/mcp` vía `uvx mcp-proxy-for-aws-cli@latest`).
- IAM y CloudTrail (`https://docs.aws.amazon.com/agent-toolkit/latest/userguide/security_iam_service-with-iam.html`): el servidor añade las claves de contexto `aws:ViaAWSMCPService=true` y `aws:CalledViaAWSMCP="aws-mcp.amazonaws.com"` a cada llamada que reenvía.
  Según un artículo de Builder Center (`https://builder.aws.com/content/3GwQ4OR236HHnt6Tz6m9m5LgdSn/...`), CloudTrail registra eventos `eventSource: aws-mcp.us-east-1.api.aws`, `eventName: CallTool`, `eventCategory: Data`.
  **Ojo [PARCIALMENTE VERIFICADO]**: fuentes secundarias indican que son *data events*, que **no aparecen en "Event history"** a menos que exista un trail con data events. En las llamadas que el servidor MCP hace a otros servicios, se espera `invokedBy: aws-mcp.amazonaws.com`. Hay que comprobarlo en la cuenta el día 1 (ver SUBMISSION.md).
- Guía del hackathon: `https://builder.aws.com/content/3JQdUYne1ujIvtoLgWiV7iBGklF/connect-your-ai-coding-agent-to-aws` (enlace aportado por la usuaria; no la releí).

## 7. Evidencia del problema (citable)

- DS N.° 083-2026-PCM (27-may-2026) actualiza el **Plan Multisectorial ante Heladas y Friaje 2025-2027** para 2026, con anexos de distritos focalizados de heladas y de friaje: `https://www.gob.pe/institucion/pcm/normas-legales/8207321-083-2026-pcm` · El Peruano: `https://elperuano.pe/noticia/296876-gobierno-actualiza-plan-contra-heladas-revise-los-distritos-priorizados-para-2026`
- Los criterios de priorización del PMHF incluyen **locales educativos** públicos de inicial y primaria con susceptibilidad alta o muy alta a heladas y friaje (MINEDU/CENEPRED): `https://cdn.www.gob.pe/uploads/document/file/9690853/7930546-anexo-n-1-criterios-de-priorizacion-consolidado-f.pdf`
- Aviso SENAMHI N.° 388 (28-sep-2026): mínimas "próximos a los −17 °C en zonas por encima de los 4000 m s. n. m. en la sierra sur" para el 2-oct: `https://www.senamhi.gob.pe/?p=aviso-meteorologico`
- 63 562 colegios rurales activos (MINEDU ESCALE vía GeoSINPAD, conteo propio).
- Estadísticas de afectación del INEI o CENEPRED (niños con IRA, etc.): **[NO VERIFICADO en esta sesión]**. Antes de citar cifras, añadirlas con su enlace exacto.

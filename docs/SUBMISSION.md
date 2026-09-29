# Envío a AWS Builder Center: Zero to Shipped

**Deadline**: 2-oct-2026 23:59 PDT (= 3-oct 01:59 PET). **Meta**: publicar el viernes 2-oct antes de las 20:00 PET. **Borrador**: miércoles 30-sep.
Tags: `#social-good` `#community`. Criterios (25 % cada uno): Innovación técnica · Calidad de implementación · Impacto comunitario/mercado · Creatividad y storytelling.

## 1. Esquema del post del proyecto

**Título**: *Aviso Andino: los avisos oficiales de SENAMHI convertidos en un SMS claro para los colegios rurales del Perú*

**Subtítulo / una línea**: "Si SENAMHI anuncia una helada fuerte sobre tu colegio, lo sabes en tu celular básico con el color, los días y qué hacer, en menos de 160 caracteres."

1. **El problema** (storytelling, criterio 4)
   - Escena: una directora en un centro poblado a 4 000 m en Puno. SENAMHI emite el aviso 388 (NARANJA, mínimas de hasta −17 °C sobre los 4 000 m en la sierra sur), pero vive en PDF, en mapas web y en redes. Ella tiene un celular básico y señal 2G.
   - Evidencia citada: DS 083-2026-PCM (Plan Multisectorial ante Heladas y Friaje, distritos focalizados 2026) y criterios de priorización de locales educativos (MINEDU/CENEPRED); 63 562 colegios rurales activos (MINEDU ESCALE). Ver README §Problema.
2. **Qué hace** (en palabras simples): registro con un pin o buscando tu colegio → cada 15 min revisamos los avisos oficiales → si tu punto cae dentro del polígono NARANJA o ROJO te llega **un** SMS → tocas el enlace para confirmar → el dashboard muestra enviados, tiempo y % confirmado.
3. **Innovación técnica** (criterio 1)
   - Encontramos y usamos el **WFS de SENAMHI** (polígonos por aviso y día, con fechas de vigencia) + el ArcGIS REST de INDECI como fallback. Punto en polígono determinista con nivel máximo.
   - "**La IA no decide**": Bedrock Nova Micro solo reescribe, y un validador determinista rechaza la salida si inventa un número, omite el color o pasa de 160 caracteres GSM-7.
   - Plantillas **GSM-7 garantizadas por tests**: 1 segmento = el costo mínimo (USD 0,23 por SMS a Perú).
   - Idempotencia por claves deterministas: **nunca dos SMS por el mismo aviso**.
   - **Todo construido y desplegado por agentes de código conectados a AWS** (Agent Toolkit / AWS MCP Server), con la prueba en CloudTrail.
4. **Calidad de implementación** (criterio 2): diagrama de arquitectura, IAM por función, DLQ, alarmas, Budget, TTL y privacidad (Ley 29733), N tests (cifra real), cobertura del core, IaC 100 % en CDK. Enlace al repo.
5. **Impacto** (criterio 3): métricas reales del período (ver §5), camino a escala (short code PE, WhatsApp, integración con UGEL/DRE, COER regionales), costo por colegio al mes (≈ USD 0,23 × avisos NARANJA+).
6. **Honestidad técnica** (suma credibilidad): el two-way SMS en Perú exige un short code dedicado, por eso confirmamos con enlace y Telegram. El sandbox limita a números verificados. Open-Meteo solo enriquece.
7. **Pruébalo**: URL pública, botón "Replay: heladas ROJO junio 2026", teléfono virtual.
8. **Cómo lo construí con agentes**: prompts usados (carpeta `prompts/`), capturas de la conexión y fragmento de CloudTrail.

## 2. Checklist de la prueba de conexión agente ↔ AWS
- [x] Captura de Cursor mostrando el servidor AWS MCP conectado (`docs/proof/cursor-aws-mcp-connected.webp`).
- [x] Captura de sus ocho herramientas y del agente llamando `aws__run_script` → `sts:GetCallerIdentity` (`docs/proof/cursor-aws-mcp-tools.webp`, `docs/proof/cursor-agent-get-caller-identity.webp`).
- [ ] Captura del agente ejecutando el deploy o las verificaciones de la stack (CloudFormation `describe-stacks`, `lambda invoke` de ingest, lectura de logs) **a través del MCP**.
- [x] Evidencia de CloudTrail (§3) con `CallReadWriteTool` y la llamada reenviada a STS, misma cuenta, fecha y `requestId` (`docs/proof/cloudtrail-mcp-2026-09-28.json`).
- [x] `docs/proof/` en el repo con capturas y JSON; el account ID está enmascarado como `5290XXXXXXXX`.
- [ ] Un párrafo en el post: "Qué hizo el agente vs qué hice yo".

## 3. Cómo obtener la prueba en CloudTrail
> Estado: **verificado el 28-sep-2026** para esta cuenta. CloudTrail registró
> `eventSource: aws-mcp.amazonaws.com`, `eventName: CallReadWriteTool`,
> `eventType: AwsMcpEvent` y `eventCategory: Management`. El evento incluye la llamada
> reenviada `sts:GetCallerIdentity`; el evento STS correspondiente tiene
> `invokedBy: aws-mcp.amazonaws.com`. Evidencia en `docs/proof/`.

1. **Llamadas reenviadas a servicios** (eventos de management, visibles en Event history 90 días):
   ```bash
   aws cloudtrail lookup-events --region us-east-1 \
     --start-time "$(date -u -d '-2 days' +%Y-%m-%dT%H:%M:%SZ)" --max-results 50 \
     --query "Events[?contains(CloudTrailEvent, 'aws-mcp.amazonaws.com')].[EventTime,EventName,EventSource]" --output table
   ```
   Buscar en el JSON del evento `"invokedBy": "aws-mcp.amazonaws.com"` (o la clave de contexto equivalente).
2. **Eventos propios del MCP (`CallTool`)**: son *data events*, así que **se necesita un trail con data events o CloudTrail Lake**. Crear el trail (el agente puede hacerlo vía MCP) con un bucket S3 y advanced event selectors para data events. Consultar la documentación del Agent Toolkit para el `resources.type` o `eventSource` exacto **[NO VERIFICADO]**. Después:
   ```bash
   aws s3 cp s3://<trail-bucket>/AWSLogs/<acct>/CloudTrail/us-east-1/2026/09/29/ . --recursive
   zcat *.json.gz | jq '.Records[] | select(.eventSource|test("aws-mcp")) | {eventTime,eventName,params:.requestParameters}' | head -50
   ```
3. Guardar la salida (con el account ID enmascarado) en `docs/proof/cloudtrail-mcp.json` y una captura de la consola.
4. Script: `scripts/cloudtrail-proof.sh` (stub) automatiza los pasos 1 y 2.

## 4. Guion del video (2:30)
| t | Imagen | Voz (español, subtítulos en inglés) |
|---|---|---|
| 0:00–0:15 | Foto o ilustración de un colegio altoandino al amanecer, escarcha | "En la sierra sur, esta semana SENAMHI anunció mínimas de hasta −17 grados. ¿Cómo se entera una directora con un celular básico?" |
| 0:15–0:30 | Web de SENAMHI con el aviso 388 y el mapa | "Los avisos existen, pero están en mapas y PDFs. Aviso Andino los convierte en un SMS claro." |
| 0:30–0:55 | Registro en el celular: buscar el colegio 70805 Charamaya, pin, canal SMS | "Busco mi colegio o pongo un pin. Nada más." |
| 0:55–1:20 | Pantalla dividida: log de ingest detectando el aviso + **SMS real llegando al celular** | "Cada 15 minutos leemos los polígonos oficiales. Si mi colegio cae en zona NARANJA, llega un SMS: color, días, temperatura prevista y qué hacer." |
| 1:20–1:35 | Toca el enlace → "Recibí el aviso" → el dashboard sube el % confirmado | "Con un toque confirmo. Así sabemos quién recibió la alerta." |
| 1:35–1:55 | Diagrama de arquitectura, resaltando "la IA no decide" | "Reglas deterministas deciden. La IA solo simplifica el texto y un validador la corrige si inventa algo." |
| 1:55–2:15 | Agente de código + CloudTrail con eventos de `aws-mcp` | "Lo construí en 4 días con agentes de código conectados a mi cuenta AWS. Aquí está la traza en CloudTrail." |
| 2:15–2:30 | Dashboard con métricas + replay del aviso 230 (junio 2026, ROJO) | "Pruébalo tú: el modo replay repite las heladas ROJO de junio de 2026 (Aviso 230). Aviso Andino: el aviso oficial, a tiempo y en tu idioma." |

## 5. Métricas a reportar (reales y con fecha de corte)
- Avisos oficiales ingeridos (N) y fuentes (SENAMHI WFS / INDECI fallback), con disponibilidad de la ingesta (% de corridas OK).
- Alertas enviadas por canal (SMS / Telegram / simulado) y % entregado (si llegan los recibos de entrega).
- **Mediana y p90 de minutos detección→envío** (y publicación→envío como cota superior).
- **% confirmado** por canal.
- SMS en un solo segmento: 100 % (garantizado por tests). Costo total real en USD y costo por alerta.
- Tests: número, cobertura de `packages/core`. Tiempo total de desarrollo y % de código generado por agentes (estimado honesto).
- Uptime de la URL del 2-oct al 9-oct (captura de CloudWatch Synthetics, opcional, o una alarma simple).

## 6. Plantilla del caso de Soporte (enviar HOY)
> **Service**: Service Quotas · **Category**: AWS End User Messaging SMS (Pinpoint) · **Region**: us-east-1 · **Quota**: SMS Production Access = 1 **and** SMS monthly spending limit = 20 USD
>
> **Use case**: Public-interest, non-commercial prototype "Aviso Andino" for the AWS Builder Center hackathon. It relays OFFICIAL SENAMHI (Peru's national weather service) weather warnings (frost, heavy rain, snow) to rural school directors in Peru who opted in via our website with explicit consent. Transactional only, no marketing. Destination country: Peru (PE). Expected volume: < 200 SMS/month during pilot.
> **Website**: https://<cloudfront-domain> (registration page with consent text and one-click opt-out).
> **Opt-in**: web form with an explicit checkbox; each message contains a link to confirm or opt out.
> **Template**: "SENAMHI NARANJA: heladas 30/09-01/10 en CHARAMAYA. Min prevista -9C. Abrigue a ninos y animales. Confirme: d1x.cloudfront.net/c/K7P2QX"

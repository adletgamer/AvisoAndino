# Prueba de la conexión agente ↔ AWS

Esta carpeta documenta una llamada real desde un agente local de Cursor hacia AWS mediante
el AWS Agent Toolkit y el AWS MCP Server. La cuenta se muestra siempre como
`5290XXXXXXXX`; no hay credenciales ni secretos en estos archivos.

## Configuración usada

- Cliente: Cursor Desktop con el servidor MCP `aws-mcp` conectado.
- Configuración local en `~/.cursor/mcp.json`:
  `uvx mcp-proxy-for-aws@latest https://aws-mcp.us-east-1.api.aws/mcp`.
- Identidad: usuario IAM de despliegue `grokbot-dev`, configurado con permisos de mínimo
  privilegio. Las claves de acceso no se guardan en este repositorio.
- Región: `us-east-1`.
- Auditoría: el trail de CloudTrail `zts-aws-mcp-proof` registra las llamadas del servidor
  como eventos de administración con `eventType: AwsMcpEvent`.

## Archivos

| Archivo | Evidencia |
|---|---|
| `cursor-aws-mcp-connected.webp` | Cursor muestra el servidor `aws-mcp` conectado y en verde. |
| `cursor-aws-mcp-tools.webp` | Lista las ocho herramientas expuestas por el servidor MCP. |
| `cursor-agent-get-caller-identity.webp` | El agente llama `aws__run_script`, ejecuta `sts:GetCallerIdentity` y recibe el usuario IAM `grokbot-dev`. |
| `cloudtrail-mcp-2026-09-28.json` | Export de CloudTrail. El evento `CallReadWriteTool` del `2026-09-28T23:48:51Z` registra `sts:GetCallerIdentity` en `downstreamRequests`; el `requestId` coincide con el evento STS inmediatamente anterior. |

El JSON también muestra `eventSource: aws-mcp.amazonaws.com` y el evento reenviado de STS
con `invokedBy: aws-mcp.amazonaws.com`. Los identificadores de cuenta y claves están
enmascarados. Esta evidencia prueba la conexión y la llamada de lectura; no afirma que el
deploy de esta pull request se haya ejecutado desde ese agente.

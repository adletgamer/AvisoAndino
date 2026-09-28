# Prueba de la conexión agente ↔ AWS (llenar durante la semana)
Capturas que debe tomar la humana (PNG, sin credenciales; account ID enmascarado si se prefiere):
1. `aws --version` (≥ 2.35.0) y `aws configure agent-toolkit` completado, o el banner "Get setup prompt" en Console Home.
2. Plugin `aws-core` instalado en el agente (Claude Code `/plugin`, Codex `/plugins` o Cursor Plugins).
3. El agente llamando una herramienta del AWS MCP Server (p. ej. `sts get-caller-identity`, `cloudformation describe-stacks`).
4. El deploy o la verificación de la stack hechos por el agente.
5. CloudTrail: eventos con `aws-mcp` (salida de `scripts/cloudtrail-proof.sh` → `cloudtrail-mcp-*.json`).

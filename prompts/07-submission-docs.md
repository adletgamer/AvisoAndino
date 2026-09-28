# Prompt 07: Documentación final y material de envío (Claude Code)

---
Contexto: **Aviso Andino** está desplegado. Lee `docs/SUBMISSION.md` (esquema del post, checklist de la prueba del agente, guion del video y métricas), `README.md` y `docs/RESEARCH.md`. Hackathon: AWS Builder Center "Zero to Shipped". Tags `#social-good #community`. Criterios al 25 %: innovación técnica, calidad de implementación, impacto comunitario/mercado y creatividad/storytelling.

## Tareas
1. **Métricas reales**: vía AWS MCP, consulta `GET /metrics` (LIVE) y los conteos de DynamoDB, y Cost Explorer del mes (servicio por servicio). Guarda `docs/metrics-snapshot-<fecha>.json`. No inventes números: si una métrica es 0 o no existe, dilo.
2. **Prueba de la conexión agente↔AWS**: ejecuta los comandos de `docs/SUBMISSION.md` §3 (lookup-events con `aws-mcp.amazonaws.com` y, si hay trail con data events, los eventos `CallTool`). Guarda la salida enmascarando el account ID en `docs/proof/cloudtrail-mcp.json`. Lista las capturas que debe tomar la humana (no puedes tomarlas tú) en `docs/proof/README.md`.
3. **README.md final**: actualiza el estado (URL pública viva, badges de tests y cobertura), métricas reales, costo real, "Qué hizo el agente vs la humana", limitaciones honestas (SMS one-way en PE, sandbox, cod_fen inferido, Open-Meteo no comercial) y roadmap (short code PE, WhatsApp vía End User Messaging Social, UGEL/DRE, quechua/aimara).
4. **Borrador del post** en `docs/POST.md` (español, con versión corta en inglés al final), siguiendo el esquema de SUBMISSION.md §1, con la imagen `docs/architecture.png`, enlaces (URL, repo, video) y citas del problema **solo con enlaces verificados** de RESEARCH.md §7.
5. **Guion del video** afinado en `docs/VIDEO.md` con los tiempos, lo que se ve en pantalla y el texto, más una lista de tomas pendientes.
6. **Ship gate**: verifica vía MCP que la stack está `UPDATE_COMPLETE`/`CREATE_COMPLETE`, que la URL devuelve 200, que el Scheduler está activo y que las alarmas están OK. Crea el tag `v1.0-submission`. Recuerda: no destruir nada hasta después del 9-oct.

## Criterios de aceptación
- `docs/POST.md` listo para pegar en Builder Center. Todas las cifras tienen fuente (métrica propia con fecha, o enlace oficial).
- `docs/proof/` contiene la salida de CloudTrail y la lista de capturas.
- README sin TODOs pendientes en las secciones visibles. Links verificados con `curl -I`.

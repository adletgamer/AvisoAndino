# Prompt 06: Tests, seguridad, costo y hardening (Claude Code)

---
Contexto: **Aviso Andino**, a días del deadline. Lee `AGENTS.md` y `docs/ARCHITECTURE.md` §"Buenas prácticas". Objetivo: calidad de implementación visible para los jueces sin romper nada en prod.

## Checklist a implementar y verificar (marca cada punto en el resumen)
**Tests**
- [ ] Cobertura de `packages/core` ≥ 90 % (Vitest `--coverage`) y reporte en el README.
- [ ] Casos 1–22 de RULES.md implementados (o `test.todo` justificados).
- [ ] Tests de handlers con `aws-sdk-client-mock` para ingest, matcher, sender, api y sms-events.
- [ ] Test de "no SMS en replay" y de "no SMS con SMS_ENABLED=false".
- [ ] Test de contrato: los schemas zod de API.md aceptan los ejemplos del doc y rechazan los inválidos.
- [ ] Test live opcional (`RUN_LIVE=1`) del **oráculo**: para 5 puntos, nuestro `effectiveLevel` coincide con el WFS `CQL_FILTER=INTERSECTS(geom,POINT(lon lat))` del aviso vigente.
- [ ] `infra/test`: sin `Action:"*"`, todas las Lambdas en arm64 + nodejs24.x, retención de logs, DLQs y Budget.

**Seguridad y privacidad**
- [ ] `maskPhone` en todos los logs (test que busca regex `\+519\d{8}` en la salida capturada del logger).
- [ ] Teléfono cifrado (`phoneEnc`) o, si se descartó la CMK, decisión documentada en `docs/DECISIONS.md`.
- [ ] Webhook de Telegram valida el secret token (test 401).
- [ ] Throttling del HTTP API configurado. `POST /replay` con allowlist. Honeypot activo.
- [ ] S3 privados con `enforceSSL`, CloudFront con HTTPS redirect y security headers (response headers policy: HSTS, nosniff, frame-deny, CSP básica compatible con teselas OSM).
- [ ] `cdk-nag` AwsSolutions: 0 errores sin justificar.
- [ ] `npm audit --omit=dev` sin vulnerabilidades altas o críticas (o justificadas).
- [ ] Secretos: `git log -p | grep -iE "bot[0-9]{6,}:|AKIA|secret"` sin resultados.

**Fiabilidad y operación**
- [ ] Alarmas: errores de cada Lambda, DLQ > 0, ingest sin éxito en 60 min, `DeliveriesFailed` > 3/h → email.
- [ ] Budget de USD 10 con alertas. Métrica propia `SmsSpendUsd` y alarma al superar USD 8 en el mes.
- [ ] Flag de emergencia: `SMS_ENABLED=false` probado en prod (degrada a SIMULATED sin redeploy).
- [ ] Runbook `docs/RUNBOOK.md`: qué hacer si el WFS cae, si el HTML de la lista cambia, si la DLQ tiene mensajes, si se agota el gasto de SMS, cómo rotar el token de Telegram y cómo pausar el Scheduler.
- [ ] Retención de logs de 14 días. Dashboard de CloudWatch (opcional) con las métricas EMF.
- [ ] (Opcional) X-Ray activo con un flag de contexto.

**Costo**
- [ ] Tabla en el README con el costo real observado (Cost Explorer vía MCP) y la estimación mensual.

## Proceso
1. Ejecuta todo en local. Muestra `cdk diff` a prod y espera el OK antes de desplegar.
2. Despliega vía Agent Toolkit / AWS MCP. Después verifica por MCP: alarmas en estado OK, Budget existente, `ssm get-parameter SMS_ENABLED` e invocación de ingest.
3. Resume en una tabla: punto → evidencia (comando o archivo) → estado.

## Criterios de aceptación
- Todo el checklist en ✅ o con justificación escrita. Prod sigue funcionando (smoke: registro, replay, métricas).

# Plan día a día (hora Lima, PET = UTC−5)

**Deadline real**: 2-oct-2026 23:59 PDT = **3-oct 01:59 PET**. **Meta interna: publicar el viernes 2-oct antes de las 20:00 PET** y no tocar prod después de las 22:00.
Owners sugeridos: **Claude** = Claude Code (arquitectura, CDK, integraciones y documentos largos) · **Codex** = tareas acotadas y testeables en paralelo (parsers, core, tests, UI) · **Humana** = Alejandra (cuentas, consola AWS, teléfono, video, decisiones).
Regla: cada tarea se cierra con **tests en verde + commit**. El deploy a `prod` lo hace el agente vía Agent Toolkit o AWS MCP.

---

## Lunes 28-sep (noche): D0, desbloquear lo lento
| # | Tarea | Owner | Criterio de aceptación |
|---|---|---|---|
| 0.1 | **Abrir un caso de Soporte: SMS Production Access + subir el gasto mensual de SMS a USD 20 en us-east-1** (plantilla en SUBMISSION.md §6) | Humana | Caso creado y su número anotado en `docs/DECISIONS.md` |
| 0.2 | Añadir el propio celular como **verified destination number** (End User Messaging → Sandbox) | Humana | Código recibido y número verificado |
| 0.3 | Crear un **AWS Budget** de USD 10 con alertas por email | Humana (o el agente vía MCP) | Budget visible |
| 0.4 | Conectar el agente: `aws --version` ≥ 2.35.0, `aws configure agent-toolkit` o el banner "Get setup prompt" de Console Home; instalar el plugin `aws-core` en Claude Code, Codex o Cursor | Humana | El agente ejecuta `sts get-caller-identity` **vía el MCP**. Captura guardada en `docs/proof/` |
| 0.5 | Crear un **trail de CloudTrail con data events** (si no existe) para capturar el uso del MCP | Agente vía MCP | Trail activo (ver SUBMISSION.md §3) |
| 0.6 | Crear el bot de Telegram con @BotFather y guardar el token en SSM SecureString `/aviso-andino/telegram/botToken` | Humana | `aws ssm get-parameter --with-decryption` funciona (no pegar el token en el chat del agente) |
| 0.7 | Repo nuevo en GitHub con este kit; ejecutar `prompts/00-bootstrap-repo.md` | Claude | `pnpm install --frozen-lockfile && pnpm test` en verde |

## Martes 29-sep: D1, core + ingesta + infra mínima desplegada
| # | Tarea | Owner | Criterio de aceptación |
|---|---|---|---|
| 1.1 | `packages/core`: levels, hazards, gsm7, templates, geo, rules (prompt 03, parte core) | Codex | Casos 1–7, 10–15 y 18–19 de RULES.md en verde con fixtures |
| 1.2 | Ingest: parser de la lista SENAMHI + cliente WFS + fallback INDECI (prompt 02) | Codex (en paralelo) | Contra el fixture HTML devuelve 388..380 con estado. El WFS con fixture da un `NormalizedWarning` válido. `RUN_LIVE=1` funciona contra la fuente real |
| 1.3 | CDK: tablas, buckets, colas+DLQ, Lambdas vacías, Scheduler, HTTP API, CloudFront+S3 (prompt 01) | Claude | `cdk synth` limpio. Test de snapshot. **Deploy a `prod` vía agente**. URL de CloudFront responde "Aviso Andino, pronto" |
| 1.4 | Ingest desplegado y corriendo cada 15 min | Claude | Warnings reales de SENAMHI en DynamoDB. Snapshot en S3. Log JSON con `warningsIngested` |
| 1.5 | Alarmas básicas: errores de Lambda, DLQ, ingest sin éxito en 1 h | Claude | Visibles en CloudWatch |

## Miércoles 30-sep: D2, matching, envío y web de registro. **Borrador publicado**
| # | Tarea | Owner | Criterio de aceptación |
|---|---|---|---|
| 2.1 | Matcher + dedup + Open-Meteo (prompt 03) | Claude | El caso 8 (reentrega) no duplica. Tmin incluida en HELADA |
| 2.2 | Sender: SMS (End User Messaging) + SIMULATED + Telegram, topes y `MaxPrice` (prompt 03) | Claude | **Primer SMS real** al número verificado con un aviso real vigente (o un replay con allowlist de teléfono) |
| 2.3 | API: `POST /subscribers`, `GET/POST /confirm`, webhook de Telegram | Codex | Tests de handlers en verde. Confirmación por enlace y por Telegram funcionando en prod |
| 2.4 | Web: registro con mapa + búsqueda de colegio + página `/c/:code` (prompt 04) | Codex | En el celular: registrarse, recibir el mensaje y confirmar |
| 2.5 | **PUBLICAR EL BORRADOR del proyecto en Builder Center** (título, pitch, imagen de arquitectura, URL pública, tags `#social-good #community`) | Humana | Post en borrador o publicado con la URL. Elimina el riesgo de última hora |
| 2.6 | Seed de suscriptores demo (10–20 colegios rurales reales de Puno y Huancavelica, canal SIMULATED) | Codex | `pnpm seed:demo` idempotente |

## Jueves 1-oct: D3, dashboard, replay y hardening
| # | Tarea | Owner | Criterio de aceptación |
|---|---|---|---|
| 3.1 | `GET /metrics`, `GET /alerts` + dashboard público con mapa de avisos vigentes (prompt 05) | Codex | Métricas coherentes con DynamoDB |
| 3.2 | Replay (`POST /replay`, allowlist 2026-230, 2025-200, 2026-388, 2026-383) + teléfono virtual (prompt 05) | Claude | Un juez sin teléfono peruano completa el flujo en < 2 min |
| 3.3 | Bedrock rewrite **detrás de un flag** + validador (prompt 03/06) | Codex | Casos 16–17 en verde. Con el flag apagado todo funciona igual |
| 3.4 | Hardening (prompt 06): IAM mínimo, logs enmascarados, TTL, throttling, Budget, alarmas, test de costo | Claude | Checklist de ARCHITECTURE.md cumplido. `cdk-nag` (AwsSolutions) sin errores críticos, o suprimidos con justificación |
| 3.5 | Grabar el material del video: SMS real llegando, confirmación, dashboard, replay y CloudTrail | Humana | Clips crudos listos |

## Viernes 2-oct: D4, pulido y envío
| # | Tarea | Owner | Criterio de aceptación |
|---|---|---|---|
| 4.1 | README final + SUBMISSION (prompt 07), capturas de CloudTrail y de la conexión del agente | Claude + Humana | Todos los enlaces funcionan |
| 4.2 | Video de 2–3 min (guion en SUBMISSION.md) y subida (YouTube no listado) | Humana | Enlace en el post |
| 4.3 | Smoke test en prod desde un celular y desde un navegador en modo incógnito | Humana | Registro, replay, dashboard y confirmación OK |
| 4.4 | **Congelar prod** (sin deploys después de las 22:00 PET). Etiqueta `v1.0-submission` | Claude | Tag creado |
| 4.5 | **Publicar/actualizar el post antes de las 20:00 PET** | Humana | Post público |

## Semana del 5-oct: ship gate (la URL debe seguir viva)
- No destruir la stack. Alarmas + Budget activos. Mirar el dashboard una vez al día.
- Ingest sigue corriendo (así el dashboard muestra avisos reales frescos para los jueces).
- Si el gasto de SMS se acerca al límite → `SMS_ENABLED=false` en SSM (degrada a SIMULATED/Telegram sin redeploy).

## Si falta tiempo (recortes en orden)
1. Bedrock rewrite (flag apagado; ya es opcional).
2. Escalamiento `SUBE_NIVEL` y horario de silencio (dejar tests `todo`).
3. Búsqueda de colegio (queda solo el pin).
4. Telegram (queda SMS a verificados + SIMULADO).
**Nunca se recorta**: URL pública viva, flujo aviso real → SMS real → confirmación, dashboard con métricas, prueba de la conexión agente↔AWS.

# Decisiones (ADR corto)
| # | Decisión | Por qué | Fecha |
|---|---|---|---|
| 1 | Fuente primaria: **SENAMHI WFS** `g_aviso:view_aviso` + lista HTML. Fallback: INDECI capa 5 | El WFS trae nro de aviso, fenómeno y vigencia; INDECI solo PP24H sin vigencia (RESEARCH §1) | 2026-09-28 |
| 2 | **No** confirmar respondiendo "1" por SMS; sí por enlace o Telegram | Two-way en PE exige short code dedicado (RESEARCH §3) | 2026-09-28 |
| 3 | `minLevel` por defecto = 3 (NARANJA) | Nivel 2 es casi diario en la sierra y cada SMS a PE cuesta USD 0,23 | 2026-09-28 |
| 4 | TypeScript + Node 24 + CDK TS | Un solo lenguaje, core compartido con la web, Turf puro JS, Node 20 deprecado | 2026-09-28 |
| 5 | S3 + CloudFront (no Amplify) | Una sola stack CDK y enlaces cortos en el mismo dominio | 2026-09-28 |
| 6 | us-east-1 | Bedrock Nova Micro, endpoint del MCP y costo | 2026-09-28 |
| 7 | Open-Meteo solo enriquece | Solo avisos oficiales disparan alertas; licencia no comercial | 2026-09-28 |
| 8 | Replay principal: aviso 230/2026 (ROJO, heladas) | Tiene Nivel 1–4 y colegios rurales dentro de Nivel 3 | 2026-09-28 |
| 9 | El primer deploy deja `scheduleEnabled=false`, `INGEST_ENABLED=false`, `SMS_ENABLED=false` y `REWRITE_ENABLED=false` | La infraestructura y los consumidores quedan cableados, pero ninguna integración externa se activa antes de completar y probar los prompts 02/03 | 2026-09-29 |
| 10 | El synth sin `apps/web/dist` despliega una página de respaldo; el comando de deploy siempre compila la web primero | Permite que CI ejecute `pnpm synth` desde un clon limpio sin guardar artefactos generados | 2026-09-29 |

Caso de Soporte SMS (production access + gasto): `#<pendiente>`

# Prompt 05: Dashboard público, métricas y modo replay (Claude Code o Codex)

---
Contexto: **Aviso Andino**. Lee `AGENTS.md`, `docs/API.md` (`GET /alerts`, `GET /metrics`, `POST /replay`), `docs/RULES.md` §6 y `docs/ARCHITECTURE.md` (e).

## Backend (`services/api` + `services/ingest` en modo replay)
1. `GET /alerts`: avisos vigentes (GSI `byActive`) agrupados por `avisoKey`, con conteos de deliveries. `GET /alerts/{warningId}/geometry` → GeoJSON simplificado (`@turf/simplify`, tolerancia 0,01, `highQuality:false`) desde el snapshot S3, con `Cache-Control: public, max-age=600`.
2. `GET /metrics?runId=LIVE|REPLAY#id`: exactamente el shape de API.md. p50/p90 calculados sobre Deliveries del run (últimos 30 días para LIVE). `publicationToSendMin` con su nota. `Cache-Control: max-age=60`.
3. `POST /replay`: valida contra la allowlist de SSM → crea `runId` → invoca `ingest` de forma asíncrona (`InvocationType: 'Event'`) con `{mode:'replay', year, nroAviso, mapa?, runId, simulatedNow}` → el matcher usa `now = simulatedNow` (default: `fechIni` del mapa 1 menos 12 h) y **solo suscriptores `isDemo=true` con canal SIMULATED**. `GET /replay/{runId}/deliveries` lista los textos para el teléfono virtual.
4. `scripts/seed-demo.ts`: crea 15–20 suscriptores demo idempotentes (IDs fijos) en colegios rurales reales de Puno, Cusco, Huancavelica, Junín y Pasco, tomados de la capa MINEDU (solo nombre, `COD_MOD`, `CEN_POB` y coordenadas), con `minLevel` variado (2 y 3), `isDemo=true` y TTL de 14 días.
5. Precarga del replay: guarda en S3 `replay/` los snapshots de los avisos de la allowlist, para que el replay funcione aunque el WFS de SENAMHI esté caído.

## Frontend (`apps/web`)
1. `/panel` **Panel público**:
   - Mapa con los polígonos de los avisos vigentes coloreados por nivel (2 amarillo, 3 naranja, 4 rojo; el Nivel 1 no se pinta), leyenda y fecha de la última ingesta ("Actualizado hace 7 min · Fuente: SENAMHI").
   - Tarjetas KPI: **Alertas enviadas**, **Minutos detección→SMS (mediana)**, **% confirmado**, suscriptores activos y avisos oficiales procesados.
   - Tabla de avisos vigentes (título, nivel, fechas, enviados y confirmados).
   - Aviso de honestidad: "Piloto: el SMS en Perú es solo de ida; la confirmación es por enlace o Telegram".
2. `/replay` **Modo demo**:
   - Selector de avisos históricos de la allowlist, con descripciones ("Heladas ROJO junio 2026, Aviso 230", "Heladas junio 2025, Aviso 200", "Descenso de temperatura sierra centro-sur, Aviso 388, sep-2026").
   - Botón "Reproducir" → polling de `/metrics?runId=` cada 2 s (máximo 60 s) → animación de los puntos demo que "reciben" el aviso (se ponen del color del nivel).
   - **Teléfono virtual**: mockup CSS de un celular básico con la bandeja de SMS del colegio elegido. Cada mensaje trae el botón "Confirmar" (`POST /confirm` con `channel=SIMULATED`), y al pulsarlo sube el % confirmado del run.
   - Explicación paso a paso a un lado ("1. SENAMHI publica → 2. Detectamos → 3. Punto en polígono → 4. SMS de 160 caracteres").
3. Enlace desde el inicio a "Pruébalo sin teléfono peruano".

## Criterios de aceptación
- Un juez sin teléfono peruano, en incógnito, reproduce "Heladas ROJO junio 2026 (Aviso 230)", ve los mensajes simulados, confirma uno y ve cambiar el % en < 2 min.
- `GET /metrics` coincide con un conteo manual en DynamoDB (el agente lo verifica vía MCP y pega el resultado).
- El replay **nunca** crea Deliveries con canal SMS (hay test).
- Tests de handlers en verde. Desplegado.

# Prompt 02: Ingesta de avisos SENAMHI/INDECI (Codex o Claude)

---
Contexto: **Aviso Andino**. Lee `AGENTS.md`, `docs/RESEARCH.md` §1 (campos reales verificados), `docs/RULES.md` §1 y `docs/DATA_MODEL.md` (`Warnings`). Trabaja en `services/ingest` y `packages/core` (tipos y normalización pura).

## Fuentes (verificadas el 28-sep-2026)
- Lista: `GET https://www.senamhi.gob.pe/?p=aviso-meteorologico` → tabla `#table_id`. Cada fila tiene 7 `<td>`: título, "388 (emitido)" o "384 (vigente)" o "379" (sin estado = vencido), emisión `YYYY-MM-DD`, inicio, fin, duración y `<span>` con AMARILLO/NARANJA/ROJO. Fixture: `fixtures/senamhi-avisos-list.2026-09-28.trimmed.html`.
- Polígonos: `GET https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=g_aviso:view_aviso&outputFormat=application/json&viewparams=qry:{nro}_{mapa}_{year}` con mapa 1..3 (un mapa por día). Propiedades: `gid, nro_aviso, nro_mapa, nivel ("Nivel 1".."Nivel 4"), fecha_emi ("2026-09-28Z"), cod_fen ("7" o "01"), cod_even, fech_ini, fech_fin (ISO Z), cod_sede, respons, pub, cap`. Geometría MultiPolygon EPSG:4326. Fixtures: `fixtures/senamhi-wfs-aviso.*.decimated.geojson`.
- Fallback: `GET https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer/5/query?where=1%3D1&outFields=NIVEL,FECHA&returnGeometry=true&outSR=4326&f=geojson&maxAllowableOffset=0.005&geometryPrecision=5`. Fixture: `fixtures/indeci-layer5-avisopp24h.2026-09-28.simplified.geojson`. **No usar `DESCRIPCIO`** (trae el texto de quebradas).

## Tareas
1. `packages/core/src/levels.ts`, `hazards.ts` y `normalize.ts`: `parseLevel("Nivel 3") → 3`, `hazardOf(cod_fen, title)` según la tabla de RULES.md (¡cod_fen 7 cubre helada nocturna y friaje diurno; desambiguar con el título!), `normalizeWfs(fc, listRow) → NormalizedWarning`, `normalizeIndeci(fc) → NormalizedWarning`. `contentHash` = sha256 sobre (nivel, fechas, coordenadas redondeadas a 4 decimales). Usa `node:crypto` en el service e inyecta el hasher en core para que siga siendo puro.
2. `services/ingest/src/senamhiList.ts`: `parseAvisoList(html) → AvisoRow[]` con `node-html-parser`, robusto a espacios o entidades HTML. Devuelve `{nro, year, status: 'emitido'|'vigente'|'vencido', title, emision, inicio, fin, color}`. Filtra `emitido|vigente`. El año sale del `href` (`a=2026`) o de la fecha de emisión.
3. `senamhiWfs.ts`: `fetchAvisoMap(nro, mapa, year)` con `fetch` nativo, timeout de 10 s, 2 reintentos con backoff y jitter, User-Agent `AvisoAndino/1.0 (+<url repo>)`. Si hay 0 features → `null`.
4. `indeci.ts`: fallback con la misma interfaz.
5. `handler.ts` (EventBridge Scheduler y también invocación directa `{mode:'replay', year, nroAviso, runId}`):
   - Lista → para cada aviso activo y cada mapa 1..3 → WFS → normaliza → `GetItem` Warnings. Si el `contentHash` no cambió, se salta. Si no → sube el GeoJSON gzip a S3 `snapshots/senamhi/{year}/{nro}_{mapa}/{iso}.geojson.gz`, hace `PutItem` (conservando `firstSeenAt` si ya existía) y envía `{warningId}` a match-queue.
   - Si la lista falla o devuelve 0 filas activas 2 veces seguidas → fallback INDECI (`source=INDECI_PP24H`), log `WARN fallback_indeci` y métrica.
   - Replay: prefija `warningId` con `REPLAY#{runId}#`, S3 `replay/…`, y **no** toca los warnings LIVE.
   - Concurrencia: máximo 3 peticiones simultáneas al WFS (pequeño pool). El total de una corrida debe caber en menos de 50 s.
   - Métricas EMF: `AvisosActivos`, `WarningsNew`, `WarningsChanged`, `FetchErrors`, `FallbackUsed`.
6. Tests (Vitest, offline con fixtures y `aws-sdk-client-mock`): parser de la lista (el fixture da 388..380 con estados correctos), normalización WFS (388_2 → 4 áreas, niveles [1,1,2,3], `hazard=HELADA`, fechas correctas), `cod_fen` "01" y "1", cod_fen 7 + título DIURNA → FRIAJE, hash estable, handler (nuevo → put + send; igual → nada; cambiado → put + send; lista caída → INDECI).
   - Test live opcional (`RUN_LIVE=1`): lista real parsea ≥ 1 aviso y el WFS de ese aviso devuelve features.
7. Script `scripts/fetch-fixtures.sh` que vuelva a bajar los fixtures (con `curl`), recortándolos como los actuales.

## Criterios de aceptación
- `npm test -w services/ingest -w packages/core` en verde offline.
- Desplegado (vía agente/MCP): una invocación manual crea Warnings reales en DynamoDB y snapshots en S3. La segunda invocación inmediata no crea nada nuevo (idempotente).
- Logs JSON sin datos personales. Duración de la corrida < 50 s.

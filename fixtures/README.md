# Fixtures (respuestas reales, 28-sep-2026 ~17:10–17:20 PET)

Sirven para tests offline. **No son datos vigentes**: no los uses para alertar. Para refrescarlos: `scripts/fetch-fixtures.sh`.

| Archivo | Origen (URL exacta) | Notas |
|---|---|---|
| `indeci-senamhi-mapserver.json` | `https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer?f=json` | Lista de capas 0–5 |
| `indeci-layer{2,3,4,5}-metadata.json` | `…/MapServer/{id}?f=json` | Campos y tipos |
| `indeci-layer5-avisopp24h.2026-09-28.simplified.json` / `.geojson` | `…/5/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&geometryPrecision=4&f=json` (y `f=geojson`) | 7 polígonos (Nivel 1, 2, 3), **simplificados**. Oráculo: punto (−69.5, −16.5) → Nivel 3 |
| `indeci-layer2-quebradas.2026-09-28.json` | `…/2/query?where=1%3D1&outFields=*&f=json&returnGeometry=true&outSR=4326` | 14 polígonos Nivel 2 (Paucartambo, Cusco), sin recortar |
| `indeci-layer4-hidrologico.2026-09-28.trimmed.json` | `…/4/query?…` | 3 de 8 puntos de estaciones hidrológicas |
| `senamhi-wfs-aviso.388_1_2026.decimated.geojson` | `https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=g_aviso:view_aviso&viewparams=qry:388_1_2026&outputFormat=application/json` | Aviso 388 (heladas, cod_fen 7), día 1 (30-sep). Geometría **decimada** (1 de cada k vértices, 4 decimales) |
| `senamhi-wfs-aviso.388_2_2026.decimated.geojson` | ídem con `qry:388_2_2026` | Día 2 (1-oct). 4 MultiPolygon: Nivel 1, 1, 2, 3 |
| `senamhi-wfs-aviso.383_1_2026.decimated.geojson` | ídem con `qry:383_1_2026` | Precipitaciones (cod_fen "01") |
| `senamhi-wfs-aviso.230_1_2026.decimated.geojson` | ídem con `qry:230_1_2026` | **Aviso 230 ROJO heladas (13-jun-2026)**, Nivel 1–4. Colegio 40383 Huambo (−72.108, −15.730) → Nivel 3 (confirmado con el oráculo WFS y con el fixture decimado). Úsalo para el replay |
| `senamhi-wfs-point-query.388_2_2026.puno.json` | ídem + `&CQL_FILTER=INTERSECTS(geom,POINT(-70.02 -15.84))&propertyName=…` | Consulta de punto del lado del servidor → Nivel 2 |
| `senamhi-avisos-list.2026-09-28.trimmed.html` | `https://www.senamhi.gob.pe/?p=aviso-meteorologico` | Tabla `#table_id`, cabecera y 12 filas (388…377) |
| `open-meteo-forecast.puno-huancavelica.2026-09-28.json` | `https://api.open-meteo.com/v1/forecast?latitude=-15.84,-12.79&longitude=-70.02,-74.97&daily=temperature_2m_min&timezone=America%2FLima&forecast_days=3` | Array de 2 ubicaciones |
| `open-meteo-elevation.puno-huancavelica.json` | `https://api.open-meteo.com/v1/elevation?latitude=-15.84,-12.79&longitude=-70.02,-74.97` | `[3817, 3727]` |
| `minedu-schools-search.puno.sample.json` | `https://geosinpad.indeci.gob.pe/indeci/rest/services/SIRAIM/SDE_IE_ESCALE_MINEDU/MapServer/0/query` (`where=D_DPTO='PUNO' AND CEN_EDU LIKE '%70%' AND DAREACENSO='Rural' AND D_ESTADO='Activo'`) | 5 colegios, **sin** campos personales |

## Niveles esperados (calculados con la geometría COMPLETA del WFS)
| Punto (lon, lat) | 388_1 | 388_2 | 383_1 |
|---|---|---|---|
| Puno ciudad (−70.02, −15.84) | 1 | **2** | **2** |
| Huancavelica (−74.97, −12.79) | **2** | **3** | 1 |
| Lima (−77.03, −12.05) | 1 | 1 | 1 |
| Cusco (−71.97, −13.53) | 1 | **2** | 1 |
| Iquitos (−73.25, −3.75) | 1 | 1 | 1 |

Con los fixtures decimados el **nivel máximo** coincide en estos 5 puntos. Dos polígonos de Nivel 1 difieren cerca de los bordes (esperable), sin efecto en el máximo. Para probar bordes, usa la geometría completa (`RUN_LIVE=1`).

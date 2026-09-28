#!/usr/bin/env bash
# Vuelve a bajar fixtures reales (ver docs/RESEARCH.md). Uso: ./scripts/fetch-fixtures.sh [nro] [year]
set -euo pipefail
cd "$(dirname "$0")/../fixtures"
NRO="${1:-388}"; YEAR="${2:-$(date +%Y)}"; TODAY="$(date +%F)"
B="https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer"
curl -fsS "$B?f=json" -o indeci-senamhi-mapserver.json
curl -fsS "$B/5/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&geometryPrecision=4" \
  -o "indeci-layer5-avisopp24h.$TODAY.simplified.geojson"
W="https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=g_aviso:view_aviso&outputFormat=application/json"
for MAPA in 1 2 3; do
  curl -fsS "$W&viewparams=qry:${NRO}_${MAPA}_${YEAR}" -o "/tmp/wfs_${NRO}_${MAPA}.json" || true
done
echo "WFS completos en /tmp/wfs_${NRO}_*.json (recortar/decimar antes de commitear: pueden pesar >2 MB)"
curl -fsS "https://api.open-meteo.com/v1/forecast?latitude=-15.84,-12.79&longitude=-70.02,-74.97&daily=temperature_2m_min&timezone=America%2FLima&forecast_days=3" \
  -o "open-meteo-forecast.puno-huancavelica.$TODAY.json"
echo "OK"

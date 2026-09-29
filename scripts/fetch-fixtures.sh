#!/usr/bin/env bash
# Refresca fixtures oficiales y genera versiones pequeñas reproducibles.
# Uso: ./scripts/fetch-fixtures.sh [nroAviso] [year]
set -euo pipefail

FIXTURES_DIR="$(cd "$(dirname "$0")/../fixtures" && pwd)"
NRO="${1:-388}"
YEAR="${2:-$(date +%Y)}"
TODAY="$(date +%F)"
USER_AGENT="AvisoAndino/1.0 (+https://github.com/adletgamer/AvisoAndino)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

download() {
  curl --fail --silent --show-error --location \
    --retry 2 --retry-all-errors --connect-timeout 10 --max-time 45 \
    --user-agent "$USER_AGENT" "$1" --output "$2"
}

LIST_URL="https://www.senamhi.gob.pe/?p=aviso-meteorologico"
LIST_RAW="$TMP_DIR/senamhi-list.html"
LIST_OUT="$FIXTURES_DIR/senamhi-avisos-list.$TODAY.trimmed.html"
download "$LIST_URL" "$LIST_RAW"
node --input-type=module - "$LIST_RAW" "$LIST_OUT" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
const html = readFileSync(input, "utf8");
if (!/<table[^>]+id=["']table_id["']/i.test(html)) {
  throw new Error("La respuesta SENAMHI no contiene #table_id");
}
const rows = (html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [])
  .filter((row) => /<td\b/i.test(row))
  .slice(0, 12);
if (rows.length === 0) throw new Error("No se encontraron filas de avisos SENAMHI");
const header = `<thead><tr><th>Aviso</th><th>Nro.</th><th>Emisión</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Nivel</th></tr></thead>`;
writeFileSync(
  output,
  `<!-- Fixture recortado de ${new Date().toISOString()} desde ${"https://www.senamhi.gob.pe/?p=aviso-meteorologico"} -->\n` +
    `<table id="table_id">${header}<tbody>${rows.join("\n")}</tbody></table>\n`,
);
NODE

INDECI_BASE="https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer"
download "$INDECI_BASE?f=json" "$FIXTURES_DIR/indeci-senamhi-mapserver.json"
for layer in 2 4 5; do
  download "$INDECI_BASE/$layer?f=json" "$FIXTURES_DIR/indeci-layer${layer}-metadata.json"
done
download \
  "$INDECI_BASE/5/query?where=1%3D1&outFields=NIVEL,FECHA&f=geojson&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&geometryPrecision=4" \
  "$FIXTURES_DIR/indeci-layer5-avisopp24h.$TODAY.simplified.geojson"

WFS_URL="https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=g_aviso:view_aviso&outputFormat=application/json"
for MAPA in 1 2 3; do
  RAW="$TMP_DIR/wfs_${NRO}_${MAPA}.json"
  OUT="$FIXTURES_DIR/senamhi-wfs-aviso.${NRO}_${MAPA}_${YEAR}.decimated.geojson"
  download "$WFS_URL&viewparams=qry:${NRO}_${MAPA}_${YEAR}" "$RAW"
  node --input-type=module - "$RAW" "$OUT" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
const collection = JSON.parse(readFileSync(input, "utf8"));
if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
  throw new Error("Respuesta WFS inválida");
}

const round = (number) => Math.round(number * 10_000) / 10_000;
const decimateRing = (ring) => {
  if (ring.length <= 600) return ring.map(([lon, lat]) => [round(lon), round(lat)]);
  const stride = Math.ceil((ring.length - 1) / 599);
  const points = ring.slice(0, -1).filter((_, index) => index % stride === 0);
  if (points.length < 3) points.push(...ring.slice(1, 4));
  const rounded = points.map(([lon, lat]) => [round(lon), round(lat)]);
  rounded.push([...rounded[0]]);
  return rounded;
};
const decimatePolygon = (polygon) => polygon.map(decimateRing);
for (const feature of collection.features) {
  const geometry = feature.geometry;
  if (geometry?.type === "Polygon") geometry.coordinates = decimatePolygon(geometry.coordinates);
  else if (geometry?.type === "MultiPolygon") geometry.coordinates = geometry.coordinates.map(decimatePolygon);
  else throw new Error(`Geometría WFS inesperada: ${geometry?.type ?? "null"}`);
}
collection._note = "Fixture para tests: coordenadas redondeadas a 4 decimales y anillos limitados a 600 puntos.";
writeFileSync(output, `${JSON.stringify(collection)}\n`);
NODE
done

download \
  "https://api.open-meteo.com/v1/forecast?latitude=-15.84,-12.79&longitude=-70.02,-74.97&daily=temperature_2m_min&timezone=America%2FLima&forecast_days=3" \
  "$FIXTURES_DIR/open-meteo-forecast.puno-huancavelica.$TODAY.json"
download \
  "https://api.open-meteo.com/v1/elevation?latitude=-15.84,-12.79&longitude=-70.02,-74.97" \
  "$FIXTURES_DIR/open-meteo-elevation.puno-huancavelica.json"

printf 'Fixtures actualizados en %s (aviso %s/%s).\n' "$FIXTURES_DIR" "$NRO" "$YEAR"

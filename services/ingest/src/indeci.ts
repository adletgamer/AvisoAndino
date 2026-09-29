import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { fetchWithRetry, type RetryOptions } from "./http.js";

export const INDECI_PP24H_URL =
  "https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer/5/query" +
  "?where=1%3D1&outFields=NIVEL,FECHA&returnGeometry=true&outSR=4326&f=geojson&maxAllowableOffset=0.005&geometryPrecision=5";

export async function fetchIndeci(
  options: RetryOptions = {},
): Promise<FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>> {
  const response = await fetchWithRetry(INDECI_PP24H_URL, options);
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    (value as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((value as { features?: unknown }).features)
  ) {
    throw new Error("Respuesta INDECI inválida");
  }
  return value as FeatureCollection<
    Polygon | MultiPolygon,
    Record<string, unknown>
  >;
}

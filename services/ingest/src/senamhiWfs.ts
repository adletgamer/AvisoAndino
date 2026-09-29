import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { fetchWithRetry, type RetryOptions } from "./http.js";

export const senamhiWfsUrl = (
  nro: number,
  mapa: number,
  year: number,
): string =>
  `https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetFeature` +
  `&typeName=g_aviso:view_aviso&outputFormat=application/json&viewparams=qry:${nro}_${mapa}_${year}`;

export async function fetchAvisoMap(
  nro: number,
  mapa: number,
  year: number,
  options: RetryOptions = {},
): Promise<FeatureCollection<
  Polygon | MultiPolygon,
  Record<string, unknown>
> | null> {
  const response = await fetchWithRetry(
    senamhiWfsUrl(nro, mapa, year),
    options,
  );
  const value: unknown = await response.json();
  if (!isFeatureCollection(value)) throw new Error("Respuesta WFS inválida");
  return value.features.length === 0 ? null : value;
}

function isFeatureCollection(
  value: unknown,
): value is FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; features?: unknown };
  return (
    candidate.type === "FeatureCollection" && Array.isArray(candidate.features)
  );
}

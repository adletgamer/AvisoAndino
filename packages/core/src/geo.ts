import type { Level, LonLat, WarningArea } from './types.js';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';

/**
 * Nivel efectivo = MÁXIMO nivel de las áreas que contienen el punto (los polígonos SENAMHI se solapan).
 * Prefiltro por bbox. Borde cuenta como dentro. Devuelve 1 si ninguna área contiene el punto.
 * TODO(prompt 03): implementar + tests con fixtures/senamhi-wfs-aviso.*.decimated.geojson (RULES.md §7).
 */
export function effectiveLevel(point: LonLat, areas: WarningArea[]): Level {
  let result: Level = 1;
  const candidate = turfPoint(point);
  for (const area of areas) {
    const [minLon, minLat, maxLon, maxLat] = area.bbox;
    if (point[0] < minLon || point[0] > maxLon || point[1] < minLat || point[1] > maxLat) continue;
    if (booleanPointInPolygon(candidate, area.geometry, { ignoreBoundary: false }) && area.level > result) {
      result = area.level;
    }
  }
  return result;
}

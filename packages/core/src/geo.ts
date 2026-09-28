import type { Level, LonLat, WarningArea } from './types.js';
// import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

/**
 * Nivel efectivo = MÁXIMO nivel de las áreas que contienen el punto (los polígonos SENAMHI se solapan).
 * Prefiltro por bbox. Borde cuenta como dentro. Devuelve 1 si ninguna área contiene el punto.
 * TODO(prompt 03): implementar + tests con fixtures/senamhi-wfs-aviso.*.decimated.geojson (RULES.md §7).
 */
export function effectiveLevel(point: LonLat, areas: WarningArea[]): Level {
  throw new Error('TODO effectiveLevel');
}

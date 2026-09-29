// Snapshots reales para el replay (copiados desde fixtures/ al bundle por CDK, commandHooks).
// Nunca se inventa contenido: si no hay snapshot local, el handler descarga de la fuente oficial.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { parseAvisoList, type AvisoRow } from "./senamhiList.js";

export type ReplayCollection = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;

export function snapshotDir(): string {
  if (process.env.REPLAY_SNAPSHOT_DIR) return process.env.REPLAY_SNAPSHOT_DIR;
  if (process.env.LAMBDA_TASK_ROOT) return path.join(process.env.LAMBDA_TASK_ROOT, "replay-snapshots");
  return fileURLToPath(new URL("../../../fixtures", import.meta.url));
}

export const listRowFile = (nro: number, year: number): string => `senamhi-avisos-list.${nro}_${year}.row.html`;
export const mapFile = (nro: number, mapa: number, year: number): string =>
  `senamhi-wfs-aviso.${nro}_${mapa}_${year}.decimated.geojson`;

/** Fila oficial de la lista SENAMHI guardada tal cual (título, color, fechas). */
export function loadListRow(nro: number, year: number, dir = snapshotDir()): AvisoRow | undefined {
  const file = path.join(dir, listRowFile(nro, year));
  if (!existsSync(file)) return undefined;
  return parseAvisoList(readFileSync(file, "utf8")).find((row) => row.nro === nro && row.year === year);
}

export function loadMap(nro: number, mapa: number, year: number, dir = snapshotDir()): ReplayCollection | undefined {
  const file = path.join(dir, mapFile(nro, mapa, year));
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as ReplayCollection;
}

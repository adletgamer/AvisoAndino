import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { hazardOf } from "./hazards.js";
import { parseLevel } from "./levels.js";
import type { BBox, NormalizedWarning, WarningArea } from "./types.js";

type WarningGeometry = Polygon | MultiPolygon;
type HashFn = (value: string) => string;

export interface WarningListRow {
  nro: number;
  year: number;
  title: string;
  color: "AMARILLO" | "NARANJA" | "ROJO";
  emision: string;
  inicio: string;
  fin: string;
}

export function normalizeWfs(
  collection: FeatureCollection<WarningGeometry, Record<string, unknown>>,
  listRow: WarningListRow,
  hash: HashFn,
): NormalizedWarning {
  if (collection.features.length === 0) throw new Error("WFS sin features");
  const first = collection.features[0]!;
  validateGeometry(first);
  const properties = first.properties;
  const nroAviso = asInteger(properties.nro_aviso, "nro_aviso");
  const mapa = asInteger(properties.nro_mapa, "nro_mapa");
  if (nroAviso !== listRow.nro)
    throw new Error("nro_aviso no coincide con la lista");
  const codFen = asInteger(properties.cod_fen, "cod_fen");
  const areas = collection.features.map(toArea);
  const fechaEmi = requireString(properties.fecha_emi, "fecha_emi").replace(
    /Z$/,
    "",
  );
  const warning: Omit<NormalizedWarning, "contentHash"> = {
    warningId: `SENAMHI#${listRow.year}#${nroAviso}#${mapa}`,
    avisoKey: `SENAMHI#${listRow.year}#${nroAviso}`,
    source: "SENAMHI_WFS",
    year: listRow.year,
    nroAviso,
    mapa,
    codFen,
    hazard: hazardOf(codFen, listRow.title),
    title: listRow.title.trim(),
    fechaEmi,
    fechIni: toIso(properties.fech_ini),
    fechFin: toIso(properties.fech_fin),
    areas,
  };
  return { ...warning, contentHash: `sha256:${hash(hashPayload(warning))}` };
}

export function normalizeIndeci(
  collection: FeatureCollection<WarningGeometry, Record<string, unknown>>,
  hash: HashFn,
): NormalizedWarning {
  if (collection.features.length === 0) throw new Error("INDECI sin features");
  const date = dateOnly(collection.features[0]!.properties.FECHA);
  const year = Number(date.slice(0, 4));
  const areas = collection.features.map(toArea);
  const warning: Omit<NormalizedWarning, "contentHash"> = {
    warningId: `INDECI#PP24H#${date}`,
    avisoKey: `INDECI#PP24H#${date}`,
    source: "INDECI_PP24H",
    year,
    nroAviso: 0,
    mapa: 1,
    codFen: 1,
    hazard: "LLUVIA",
    title: "PRECIPITACION EN LAS PROXIMAS 24 HORAS",
    fechaEmi: date,
    fechIni: `${date}T05:00:00.000Z`,
    fechFin: nextLimaDayEnd(date),
    areas,
  };
  return { ...warning, contentHash: `sha256:${hash(hashPayload(warning))}` };
}

function toArea(
  feature: Feature<WarningGeometry, Record<string, unknown>>,
): WarningArea {
  validateGeometry(feature);
  const levelRaw =
    "nivel" in feature.properties
      ? feature.properties.nivel
      : feature.properties.NIVEL;
  if (typeof levelRaw !== "string" && typeof levelRaw !== "number")
    throw new Error("nivel inválido");
  return {
    level: parseLevel(levelRaw),
    geometry: feature.geometry,
    bbox: geometryBbox(feature.geometry),
  };
}

function validateGeometry(feature: Feature<WarningGeometry, unknown>): void {
  if (
    !feature.geometry ||
    !["Polygon", "MultiPolygon"].includes(feature.geometry.type)
  ) {
    throw new Error("Geometría de aviso inválida");
  }
}

function geometryBbox(geometry: WarningGeometry): BBox {
  const numbers: [number, number][] = [];
  collectPositions(geometry.coordinates, numbers);
  if (numbers.length === 0) throw new Error("Geometría vacía");
  return numbers.reduce<BBox>(
    (box, [lon, lat]) => [
      Math.min(box[0], lon),
      Math.min(box[1], lat),
      Math.max(box[2], lon),
      Math.max(box[3], lat),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function collectPositions(value: unknown, output: [number, number][]): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    output.push([value[0], value[1]]);
    return;
  }
  for (const child of value) collectPositions(child, output);
}

function hashPayload(warning: Omit<NormalizedWarning, "contentHash">): string {
  return JSON.stringify({
    fechIni: warning.fechIni,
    fechFin: warning.fechFin,
    areas: warning.areas.map((area) => ({
      level: area.level,
      coordinates: roundCoordinates(area.geometry.coordinates),
    })),
  });
}

function roundCoordinates(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 10_000) / 10_000;
  if (Array.isArray(value)) return value.map(roundCoordinates);
  return value;
}

function asInteger(value: unknown, name: string): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error(`${name} inválido`);
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`${name} inválido`);
  return parsed;
}

function toIso(value: unknown): string {
  if (typeof value !== "string") throw new Error("Fecha inválida");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return date.toISOString().replace(".000Z", "Z");
}

function dateOnly(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("FECHA INDECI inválida");
  const date = new Date(
    typeof value === "number"
      ? value
      : /^\d+$/.test(value)
        ? Number(value)
        : value,
  );
  if (Number.isNaN(date.getTime())) throw new Error("FECHA INDECI inválida");
  return date.toISOString().slice(0, 10);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} inválido`);
  return value;
}

function nextLimaDayEnd(date: string): string {
  const next = new Date(`${date}T05:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCMilliseconds(next.getUTCMilliseconds() - 1);
  return next.toISOString();
}

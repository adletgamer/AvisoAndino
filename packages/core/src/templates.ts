import type { TemplateId } from "./types.js";
import { isGsm7, sanitizeToGsm7 } from "./gsm7.js";

/** Plantillas exactas de docs/RULES.md §3 (máx. 160 GSM-7 en el peor caso; hay test). */
export const TEMPLATES: Record<TemplateId, string> = {
  HELADA:
    "SENAMHI {COLOR}: heladas {fechas} en {lugar}. Min prevista {tmin}C. Abrigue a ninos y animales. Confirme: {link}",
  HELADA_SIN_TMIN:
    "SENAMHI {COLOR}: heladas {fechas} en {lugar}. Abrigue a ninos y animales. Confirme: {link}",
  LLUVIA:
    "SENAMHI {COLOR}: lluvias fuertes {fechas} en {lugar}. Cuidado con huaicos y rios. Confirme: {link}",
  FRIAJE:
    "SENAMHI {COLOR}: friaje y lluvias {fechas} en {lugar}. Abrigue a los ninos. Confirme: {link}",
  NEVADA:
    "SENAMHI {COLOR}: nevada {fechas} en {lugar}. Proteja a ninos y animales. Confirme: {link}",
  GENERICO:
    "SENAMHI {COLOR}: aviso {nro} {fechas} en {lugar}. Siga a sus autoridades. Confirme: {link}",
  SUBE_NIVEL:
    "SENAMHI SUBE a {COLOR}: aviso {nro} {fechas} en {lugar}. Extreme cuidado. Confirme: {link}",
  BIENVENIDA:
    "Aviso Andino: registro OK para {lugar}. Le avisaremos solo con avisos oficiales SENAMHI. Baja: {link}",
};

export const MAX_LUGAR = 18;

export interface TemplateVars {
  COLOR?: string;
  fechas?: string;
  lugar: string;
  tmin?: number;
  nro?: number;
  link: string; // sin https:// (ej. d111111abcdef8.cloudfront.net/c/K7P2QX)
}

/** Sanea y limita variables, sustituye placeholders y garantiza un segmento GSM-7. */
export function render(id: TemplateId, vars: TemplateVars): string {
  const lugar = truncatePlace(sanitizeToGsm7(vars.lugar.trim()));
  const values: Record<string, string> = {
    COLOR: vars.COLOR ?? "",
    fechas: vars.fechas ?? "",
    lugar,
    tmin: vars.tmin === undefined ? "" : String(Math.round(vars.tmin)),
    nro: vars.nro === undefined ? "" : String(vars.nro),
    link: vars.link.replace(/^https?:\/\//, ""),
  };
  const text = TEMPLATES[id].replace(
    /\{(\w+)\}/g,
    (_match, key: string) => values[key] ?? "",
  );
  if (!isGsm7(text)) throw new Error(`La plantilla ${id} no es GSM-7`);
  if ([...text].length > 160)
    throw new Error(`La plantilla ${id} supera 160 caracteres`);
  return text;
}

/** "2026-09-30T05:00:00Z","2026-10-02T04:59:59Z" -> "30/09-01/10" en hora Lima. */
export function formatFechas(fechIni: string, fechFin: string): string {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
  });
  const short = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Fechas inválidas");
    const parts = Object.fromEntries(
      format.formatToParts(date).map((part) => [part.type, part.value]),
    );
    return `${parts.day!.padStart(2, "0")}/${parts.month!.padStart(2, "0")}`;
  };
  const start = short(fechIni);
  const end = short(fechFin);
  return start === end ? start : `${start}-${end}`;
}

function truncatePlace(value: string): string {
  if (value.length <= MAX_LUGAR) return value;
  const clipped = value.slice(0, MAX_LUGAR);
  const lastSpace = clipped.lastIndexOf(" ");
  return lastSpace >= Math.floor(MAX_LUGAR / 2)
    ? clipped.slice(0, lastSpace)
    : clipped;
}

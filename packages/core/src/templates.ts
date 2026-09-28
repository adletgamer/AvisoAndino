import type { TemplateId } from './types.js';

/** Plantillas exactas de docs/RULES.md §3 (máx. 160 GSM-7 en el peor caso; hay test). */
export const TEMPLATES: Record<TemplateId, string> = {
  HELADA: 'SENAMHI {COLOR}: heladas {fechas} en {lugar}. Min prevista {tmin}C. Abrigue a ninos y animales. Confirme: {link}',
  HELADA_SIN_TMIN: 'SENAMHI {COLOR}: heladas {fechas} en {lugar}. Abrigue a ninos y animales. Confirme: {link}',
  LLUVIA: 'SENAMHI {COLOR}: lluvias fuertes {fechas} en {lugar}. Cuidado con huaicos y rios. Confirme: {link}',
  FRIAJE: 'SENAMHI {COLOR}: friaje y lluvias {fechas} en {lugar}. Abrigue a los ninos. Confirme: {link}',
  NEVADA: 'SENAMHI {COLOR}: nevada {fechas} en {lugar}. Proteja a ninos y animales. Confirme: {link}',
  GENERICO: 'SENAMHI {COLOR}: aviso {nro} {fechas} en {lugar}. Siga a sus autoridades. Confirme: {link}',
  SUBE_NIVEL: 'SENAMHI SUBE a {COLOR}: aviso {nro} {fechas} en {lugar}. Extreme cuidado. Confirme: {link}',
  BIENVENIDA: 'Aviso Andino: registro OK para {lugar}. Le avisaremos solo con avisos oficiales SENAMHI. Baja: {link}',
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

/** TODO(prompt 03): sanitizar lugar a GSM-7, truncar a MAX_LUGAR, reemplazar placeholders, validar isGsm7 && length<=160 (lanzar si no). */
export function render(id: TemplateId, vars: TemplateVars): string {
  throw new Error('TODO render');
}

/** "2026-09-30T05:00:00Z","2026-10-02T04:59:59Z" -> "30/09-01/10" en hora Lima. TODO(prompt 03) */
export function formatFechas(fechIni: string, fechFin: string): string {
  throw new Error('TODO formatFechas');
}

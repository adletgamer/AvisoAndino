import { parse } from 'node-html-parser';
import { fetchWithRetry, type RetryOptions } from './http.js';

export type AvisoStatus = 'emitido' | 'vigente' | 'vencido';
export type AvisoColor = 'AMARILLO' | 'NARANJA' | 'ROJO';

export interface AvisoRow {
  nro: number;
  year: number;
  status: AvisoStatus;
  title: string;
  emision: string;
  inicio: string;
  fin: string;
  color: AvisoColor;
}

export const SENAMHI_LIST_URL = 'https://www.senamhi.gob.pe/?p=aviso-meteorologico';

export function parseAvisoList(html: string): AvisoRow[] {
  const root = parse(html);
  const table = root.querySelector('#table_id');
  if (!table) throw new Error('No se encontró la tabla #table_id de SENAMHI');

  const rows: AvisoRow[] = [];
  // El HTML real omite varios </a>; parsear cada <tr> por separado evita que
  // un enlace mal cerrado absorba las filas siguientes.
  const rowFragments = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  for (const fragment of rowFragments) {
    const rawCells = [...fragment.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] ?? '');
    const cells = rawCells.map((cell) => parse(cell));
    if (cells.length !== 7) continue;
    const title = clean(cells[0]!.textContent);
    const numberText = clean(cells[1]!.textContent);
    const match = numberText.match(/^(\d+)(?:\s*\((emitido|vigente)\))?/i);
    if (!match) continue;
    const emision = clean(cells[2]!.textContent);
    const href = cells[0]!.querySelector('a')?.getAttribute('href') ?? cells[1]!.querySelector('a')?.getAttribute('href') ?? '';
    const yearMatch = href.match(/[?&]a=(\d{4})(?:&|$)/);
    const color = clean(cells[6]!.textContent).toUpperCase();
    if (!isColor(color) || !isDate(emision)) continue;
    rows.push({
      nro: Number(match[1]),
      year: yearMatch ? Number(yearMatch[1]) : Number(emision.slice(0, 4)),
      status: (match[2]?.toLowerCase() as AvisoStatus | undefined) ?? 'vencido',
      title,
      emision,
      inicio: clean(cells[3]!.textContent),
      fin: clean(cells[4]!.textContent),
      color,
    });
  }
  return rows;
}

export async function fetchAvisoList(options: RetryOptions = {}): Promise<AvisoRow[]> {
  const response = await fetchWithRetry(SENAMHI_LIST_URL, options);
  return parseAvisoList(await response.text());
}

function clean(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isColor(value: string): value is AvisoColor {
  return value === 'AMARILLO' || value === 'NARANJA' || value === 'ROJO';
}

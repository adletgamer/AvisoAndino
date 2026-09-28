import type { Hazard } from './types.js';

/** Inferido el 28-sep-2026 comparando WFS vs lista SENAMHI (docs/RESEARCH.md §1B). cod_fen llega como "1" o "01". */
export const COD_FEN_TO_HAZARD: Record<number, Hazard> = {
  1: 'LLUVIA',
  2: 'FRIAJE',
  3: 'LLOVIZNA',
  4: 'NEVADA',
  5: 'CALOR',
  7: 'HELADA', // ojo: usar hazardOf(codFen, title)
  10: 'VIENTO',
};

export const DEFAULT_HAZARDS: Hazard[] = ['HELADA', 'FRIAJE', 'LLUVIA', 'NEVADA'];

export function codFenToHazard(codFen: string | number): Hazard {
  const n = typeof codFen === 'number' ? codFen : Number.parseInt(codFen, 10);
  return COD_FEN_TO_HAZARD[n] ?? 'DESCONOCIDO';
}

/**
 * cod_fen 7 = "descenso de temperatura" y cubre dos cosas: NOCTURNA en la sierra (heladas, aviso 388/2026)
 * y DIURNA en la selva (friaje, aviso 247/2026). Hay que desambiguar con el título de la lista SENAMHI.
 */
export function hazardOf(codFen: string | number, title = ''): Hazard {
  const h = codFenToHazard(codFen);
  if (h === 'HELADA') {
    const t = title.toUpperCase();
    if (t.includes('DIURNA') || t.includes('FRIAJE')) return 'FRIAJE';
  }
  return h;
}

import type { Level } from './types.js';

export const LEVEL_COLOR: Record<Exclude<Level, 1>, 'AMARILLO' | 'NARANJA' | 'ROJO'> = {
  2: 'AMARILLO',
  3: 'NARANJA',
  4: 'ROJO',
};

/** "Nivel 3" -> 3. Lanza error si no reconoce el formato (verificado en WFS e INDECI: "Nivel N"). */
export function parseLevel(raw: string | number): Level {
  const match = String(raw).trim().match(/^(?:nivel\s*)?([1-4])$/i);
  if (!match) throw new Error(`Nivel inválido: ${String(raw)}`);
  return Number(match[1]) as Level;
}

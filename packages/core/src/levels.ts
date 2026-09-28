import type { Level } from './types.js';

export const LEVEL_COLOR: Record<Exclude<Level, 1>, 'AMARILLO' | 'NARANJA' | 'ROJO'> = {
  2: 'AMARILLO',
  3: 'NARANJA',
  4: 'ROJO',
};

/** "Nivel 3" -> 3. Lanza error si no reconoce el formato (verificado en WFS e INDECI: "Nivel N"). */
export function parseLevel(raw: string | number): Level {
  // TODO(prompt 03): implementar + tests (acepta 3, "3", "Nivel 3", " nivel 3 ")
  throw new Error('TODO parseLevel');
}

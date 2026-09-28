import { describe, expect, it } from 'vitest';
import { isGsm7, sanitizeToGsm7, segments } from '../src/gsm7.js';
import { TEMPLATES } from '../src/templates.js';

describe('gsm7', () => {
  it('quita tildes pero conserva ñ', () => {
    expect(sanitizeToGsm7('Heladas en Mañazo, Huancané: niños')).toBe('Heladas en Mañazo, Huancane: niños');
  });
  it('detecta UCS-2 por tildes', () => {
    expect(isGsm7('lluvia en Apurímac')).toBe(false);
    expect(segments('á'.repeat(71)).encoding).toBe('UCS2');
  });
  it('todas las plantillas en peor caso son GSM-7 y <=160', () => {
    const worst = { COLOR: 'AMARILLO', fechas: '30/09-02/10', lugar: 'X'.repeat(18), tmin: '-12', nro: '388', link: 'd111111abcdef8.cloudfront.net/c/K7P2QX' } as Record<string, string>;
    for (const [id, t] of Object.entries(TEMPLATES)) {
      const s = t.replace(/\{(\w+)\}/g, (_, k: string) => worst[k] ?? '');
      expect(isGsm7(s), id).toBe(true);
      expect(s.length, id).toBeLessThanOrEqual(160);
    }
  });
});

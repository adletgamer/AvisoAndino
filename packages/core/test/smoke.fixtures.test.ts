import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8'));

describe('fixtures reales (28-sep-2026)', () => {
  it('WFS aviso 388 mapa 2 tiene 4 MultiPolygon con Nivel 1-3', () => {
    const fc = fx('senamhi-wfs-aviso.388_2_2026.decimated.geojson');
    expect(fc.features).toHaveLength(4);
    const niveles = fc.features.map((f: any) => f.properties.nivel).sort();
    expect(niveles).toEqual(['Nivel 1', 'Nivel 1', 'Nivel 2', 'Nivel 3']);
    expect(fc.features[0].geometry.type).toBe('MultiPolygon');
    expect(fc.features[0].properties.cod_fen).toBe('7');
  });
});

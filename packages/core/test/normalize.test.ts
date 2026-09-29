import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { normalizeIndeci, normalizeWfs } from '../src/normalize.js';

const fixture = (name: string): FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>> =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8')) as
    FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
const row = {
  nro: 388,
  year: 2026,
  title: 'DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR',
  color: 'NARANJA' as const,
  emision: '2026-09-28',
  inicio: '2026-09-30',
  fin: '2026-10-02',
};

describe('normalización', () => {
  it('normaliza 388_2 con sus cuatro áreas, niveles, peligro y fechas', () => {
    const warning = normalizeWfs(
      fixture('senamhi-wfs-aviso.388_2_2026.decimated.geojson') as Parameters<typeof normalizeWfs>[0],
      row,
      () => 'abc',
    );
    expect(warning).toMatchObject({
      warningId: 'SENAMHI#2026#388#2',
      avisoKey: 'SENAMHI#2026#388',
      hazard: 'HELADA',
      fechaEmi: '2026-09-28',
      fechIni: '2026-10-01T05:00:00Z',
      fechFin: '2026-10-02T04:59:59Z',
      contentHash: 'sha256:abc',
    });
    expect(warning.areas.map((area) => area.level)).toEqual([3, 1, 2, 1]);
    expect(warning.areas.every((area) => area.bbox.every(Number.isFinite))).toBe(true);
  });

  it('produce un payload estable redondeado a cuatro decimales', () => {
    const inputs: string[] = [];
    const collection = fixture('senamhi-wfs-aviso.388_2_2026.decimated.geojson');
    normalizeWfs(collection as Parameters<typeof normalizeWfs>[0], row, (value) => {
      inputs.push(value);
      return 'same';
    });
    normalizeWfs(JSON.parse(JSON.stringify(collection)) as Parameters<typeof normalizeWfs>[0], row, (value) => {
      inputs.push(value);
      return 'same';
    });
    expect(inputs[0]).toBe(inputs[1]);
    expect(inputs[0]).not.toContain('25809');
  });

  it('normaliza INDECI sin usar DESCRIPCIO', () => {
    const warning = normalizeIndeci(
      fixture('indeci-layer5-avisopp24h.2026-09-28.simplified.geojson') as Parameters<typeof normalizeIndeci>[0],
      () => 'indeci',
    );
    expect(warning).toMatchObject({
      warningId: 'INDECI#PP24H#2026-09-28',
      hazard: 'LLUVIA',
      nroAviso: 0,
      fechIni: '2026-09-28T05:00:00.000Z',
      fechFin: '2026-09-29T04:59:59.999Z',
    });
    expect(warning.title).not.toContain('quebradas');
  });
});

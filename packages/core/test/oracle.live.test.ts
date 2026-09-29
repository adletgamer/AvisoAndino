import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { effectiveLevel, normalizeWfs, parseLevel } from "../src/index.js";

const runLive = process.env.RUN_LIVE === "1";

describe.skipIf(!runLive)("oráculo WFS en vivo", () => {
  it("coincide con INTERSECTS para cinco puntos del aviso 388 mapa 2", async () => {
    const collection = JSON.parse(
      readFileSync(
        new URL(
          "../../../fixtures/senamhi-wfs-aviso.388_2_2026.decimated.geojson",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
    const warning = normalizeWfs(
      collection,
      {
        nro: 388,
        year: 2026,
        title: "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
        color: "NARANJA",
        emision: "2026-09-28",
        inicio: "2026-09-30",
        fin: "2026-10-02",
      },
      () => "live",
    );
    const points = [
      [-70.02, -15.84],
      [-74.97, -12.79],
      [-77.03, -12.05],
      [-71.97, -13.53],
      [-73.25, -3.75],
    ] as const;
    for (const [lon, lat] of points) {
      const url = new URL(
        "https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows",
      );
      url.search = new URLSearchParams({
        service: "WFS",
        version: "1.0.0",
        request: "GetFeature",
        typeName: "g_aviso:view_aviso",
        outputFormat: "application/json",
        viewparams: "qry:388_2_2026",
        CQL_FILTER: `INTERSECTS(geom,POINT(${lon} ${lat}))`,
        propertyName: "nivel",
      }).toString();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      expect(response.ok).toBe(true);
      const remote = (await response.json()) as {
        features: Array<{ properties: { nivel: string } }>;
      };
      const remoteLevel = Math.max(
        1,
        ...remote.features.map((feature) =>
          parseLevel(feature.properties.nivel),
        ),
      );
      expect(effectiveLevel([lon, lat], warning.areas), `${lon},${lat}`).toBe(
        remoteLevel,
      );
    }
  }, 60_000);
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  decide,
  effectiveLevel,
  hazardOf,
  normalizeIndeci,
  normalizeWfs,
  parseLevel,
  render,
  sanitizeToGsm7,
  segments,
  TEMPLATES,
  validateRewrite,
  type NormalizedWarning,
  type Subscriber,
  type TemplateId,
} from "../src/index.js";

const fixture = (
  name: string,
): FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>> =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"),
  ) as FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
const hash = (value: string) => `test-${value.length}-${value.slice(0, 20)}`;

const row388 = {
  nro: 388,
  year: 2026,
  title: "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
  color: "NARANJA" as const,
  emision: "2026-09-28",
  inicio: "2026-09-30",
  fin: "2026-10-02",
};
const w388_1 = normalizeWfs(
  fixture("senamhi-wfs-aviso.388_1_2026.decimated.geojson") as Parameters<
    typeof normalizeWfs
  >[0],
  row388,
  hash,
);
const w388_2 = normalizeWfs(
  fixture("senamhi-wfs-aviso.388_2_2026.decimated.geojson") as Parameters<
    typeof normalizeWfs
  >[0],
  row388,
  hash,
);
const w383 = normalizeWfs(
  fixture("senamhi-wfs-aviso.383_1_2026.decimated.geojson") as Parameters<
    typeof normalizeWfs
  >[0],
  {
    nro: 383,
    year: 2026,
    title: "PRECIPITACIONES EN LA COSTA NORTE Y SIERRA",
    color: "NARANJA",
    emision: "2026-09-26",
    inicio: "2026-09-28",
    fin: "2026-09-29",
  },
  hash,
);

function subscriber(
  lon: number,
  lat: number,
  minLevel: 2 | 3 | 4,
  overrides: Partial<Subscriber> = {},
): Subscriber {
  return {
    subscriberId: "SUB1",
    status: "ACTIVE",
    channel: "SMS",
    lon,
    lat,
    centroPoblado: "CHARAMAYA",
    minLevel,
    hazards: ["HELADA", "LLUVIA", "FRIAJE", "NEVADA"],
    isDemo: false,
    ...overrides,
  };
}

function decision(
  warningGroup: NormalizedWarning[],
  sub: Subscriber,
  overrides: Partial<Parameters<typeof decide>[0]> = {},
) {
  return decide({
    subscriber: sub,
    warningGroup,
    alreadySentLevels: [],
    sentTodayToSubscriber: 0,
    globalSentToday: 0,
    now: new Date("2026-09-29T18:00:00Z"),
    ...overrides,
  });
}

describe("niveles, peligros y geometría", () => {
  it("parsea solamente niveles 1 a 4", () => {
    expect(parseLevel(" nivel 3 ")).toBe(3);
    expect(parseLevel(4)).toBe(4);
    expect(() => parseLevel("Nivel 5")).toThrow();
  });

  it("casos 1-5: obtiene el nivel máximo esperado del aviso 388_2", () => {
    expect(effectiveLevel([-74.97, -12.79], w388_2.areas)).toBe(3);
    expect(effectiveLevel([-70.02, -15.84], w388_2.areas)).toBe(2);
    expect(effectiveLevel([-77.03, -12.05], w388_2.areas)).toBe(1);
    expect(effectiveLevel([-71.97, -13.53], w388_2.areas)).toBe(2);
  });

  it("casos 19 y 19b: normaliza cod_fen y desambigua el 7", () => {
    expect(hazardOf("01", "")).toBe("LLUVIA");
    expect(hazardOf("1", "")).toBe("LLUVIA");
    expect(
      hazardOf(7, "DESCENSO DE TEMPERATURA DIURNA EN LA SELVA - CUARTO FRIAJE"),
    ).toBe("FRIAJE");
    expect(hazardOf(7, "DESCENSO DE TEMPERATURA NOCTURNA")).toBe("HELADA");
  });
});

describe("casos deterministas de RULES.md", () => {
  it("1: Huancavelica N3 envía helada naranja", () => {
    const result = decision([w388_2], subscriber(-74.97, -12.79, 3));
    expect(result).toMatchObject({
      send: true,
      level: 3,
      template: "HELADA_SIN_TMIN",
    });
  });

  it("2-5: aplica fuera de área y umbral", () => {
    expect(decision([w388_2], subscriber(-70.02, -15.84, 3))).toMatchObject({
      send: false,
      reason: "below_min_level",
    });
    expect(decision([w388_2], subscriber(-70.02, -15.84, 2))).toMatchObject({
      send: true,
      level: 2,
    });
    expect(decision([w388_2], subscriber(-77.03, -12.05, 2))).toMatchObject({
      send: false,
      reason: "outside_polygons",
    });
    expect(decision([w388_2], subscriber(-71.97, -13.53, 2))).toMatchObject({
      send: true,
      level: 2,
    });
  });

  it("6: agrega mapas en un SMS al máximo nivel y rango", () => {
    expect(
      decision([w388_1, w388_2], subscriber(-74.97, -12.79, 2)),
    ).toMatchObject({
      send: true,
      level: 3,
      fechas: "30/09-01/10",
      warningIds: [w388_1.warningId, w388_2.warningId],
    });
  });

  it("7: lluvia usa su plantilla", () => {
    expect(
      decision([w383], subscriber(-70.02, -15.84, 2), {
        now: new Date("2026-09-28T01:00:00Z"),
      }),
    ).toMatchObject({ send: true, level: 2, template: "LLUVIA" });
  });

  it("8: mismo nivel ya enviado no repite", () => {
    expect(
      decision([w388_2], subscriber(-74.97, -12.79, 2), {
        alreadySentLevels: [3],
      }),
    ).toMatchObject({ send: false, reason: "already_sent" });
  });

  it("9: un nivel mayor usa SUBE_NIVEL", () => {
    expect(
      decision([w388_2], subscriber(-74.97, -12.79, 2), {
        alreadySentLevels: [2],
      }),
    ).toMatchObject({ send: true, level: 3, template: "SUBE_NIVEL" });
  });

  it("10: fenómeno desconocido no se envía", () => {
    const unknown = { ...w388_2, codFen: 99, hazard: "DESCONOCIDO" as const };
    expect(decision([unknown], subscriber(-74.97, -12.79, 2))).toMatchObject({
      send: false,
      reason: "unknown_cod_fen",
    });
  });

  it("11: aviso vencido no se envía", () => {
    expect(
      decision([w388_2], subscriber(-74.97, -12.79, 2), {
        now: new Date("2026-10-03T00:00:00Z"),
      }),
    ).toMatchObject({ send: false, reason: "expired" });
  });

  it("12-13: solo N2 se programa durante silencio", () => {
    const quiet = new Date("2026-10-01T03:30:00Z");
    expect(
      decision([w388_2], subscriber(-70.02, -15.84, 2), { now: quiet })
        .scheduleAt,
    ).toBe("2026-10-01T11:00:00.000Z");
    expect(
      decision([w388_2], subscriber(-74.97, -12.79, 3), { now: quiet })
        .scheduleAt,
    ).toBeUndefined();
  });

  it("14: cuarto SMS degrada a simulado", () => {
    expect(
      decision([w388_2], subscriber(-74.97, -12.79, 3), {
        sentTodayToSubscriber: 3,
      }),
    ).toMatchObject({ send: true, channelOverride: "SIMULATED", capped: true });
  });

  it("aplica elegibilidad, preferencias y tope global", () => {
    expect(
      decision([w388_2], subscriber(-74.97, -12.79, 3, { status: "PENDING" })),
    ).toMatchObject({ send: false, reason: "not_active" });
    expect(
      decision(
        [w388_2],
        subscriber(-74.97, -12.79, 3, { hazards: ["LLUVIA"] }),
      ),
    ).toMatchObject({ send: false, reason: "hazard_disabled" });
    expect(
      decision([w388_2], subscriber(-74.97, -12.79, 3), {
        globalSentToday: 30,
      }),
    ).toMatchObject({ send: true, channelOverride: "SIMULATED", capped: true });
  });

  it("suprime extensión reciente y no reenvía bajadas", () => {
    const extension = {
      ...w388_2,
      nroAviso: 389,
      title: "EXTENSIÓN DEL AVISO 388",
    };
    expect(
      decision([extension], subscriber(-74.97, -12.79, 2), {
        extensionPreviousSentAt: new Date("2026-09-29T10:00:00Z"),
      }),
    ).toMatchObject({ send: false, reason: "extension_suppressed" });
    expect(
      decision([w388_2], subscriber(-70.02, -15.84, 2), {
        alreadySentLevels: [3],
      }),
    ).toMatchObject({ send: false, reason: "lower_than_sent" });
  });

  it("18: fallback INDECI da nivel 3 en el punto oráculo", () => {
    const warning = normalizeIndeci(
      fixture(
        "indeci-layer5-avisopp24h.2026-09-28.simplified.geojson",
      ) as Parameters<typeof normalizeIndeci>[0],
      hash,
    );
    expect(effectiveLevel([-69.5, -16.5], warning.areas)).toBe(3);
  });

  it("19c: replay 230 ubica Huambo en nivel 3", () => {
    const warning = normalizeWfs(
      fixture("senamhi-wfs-aviso.230_1_2026.decimated.geojson") as Parameters<
        typeof normalizeWfs
      >[0],
      {
        ...row388,
        nro: 230,
        title: row388.title,
        emision: "2026-06-11",
        inicio: "2026-06-13",
        fin: "2026-06-14",
      },
      hash,
    );
    expect(effectiveLevel([-72.108, -15.73], warning.areas)).toBe(3);
  });
});

describe("trampas de datos verificadas con fixtures reales", () => {
  it("trap_level_1_hard_floor: Nivel 1 nunca envía aunque minLevel se fuerce a 1", () => {
    const loweredThreshold = subscriber(-77.03, -12.05, 2, {
      minLevel: 1 as Subscriber["minLevel"],
    });

    expect(effectiveLevel([loweredThreshold.lon, loweredThreshold.lat], w388_2.areas)).toBe(1);
    expect(decision([w388_2], loweredThreshold)).toMatchObject({
      send: false,
      level: 1,
      reason: "outside_polygons",
    });
  });

  it("trap_indeci_descripcio: el texto saliente LLUVIA nunca usa DESCRIPCIO de quebradas", () => {
    const indeciFixture = fixture(
      "indeci-layer5-avisopp24h.2026-09-28.simplified.geojson",
    );
    const sourceDescription = String(
      indeciFixture.features[0]?.properties.DESCRIPCIO,
    );
    expect(sourceDescription.toLowerCase()).toContain("quebradas");

    const warning = normalizeIndeci(indeciFixture, hash);
    const result = decision(
      [warning],
      subscriber(-69.5, -16.5, 3, { centroPoblado: "DESAGUADERO" }),
      { now: new Date("2026-09-28T18:00:00Z") },
    );
    expect(result).toMatchObject({
      send: true,
      level: 3,
      template: "LLUVIA",
    });

    const outgoingText = render(result.template!, {
      COLOR: "NARANJA",
      fechas: result.fechas!,
      lugar: "DESAGUADERO",
      nro: warning.nroAviso,
      link: "d111111abcdef8.cloudfront.net/c/K7P2QX",
    });
    expect(outgoingText).toContain("lluvias fuertes");
    expect(outgoingText.toLowerCase()).not.toContain("quebradas");
    expect(outgoingText).not.toContain(sourceDescription);
  });

  it("trap_cod_fen_7_wording: NOCTURNA renderiza heladas y DIURNA/FRIAJE renderiza friaje", () => {
    const collection = fixture(
      "senamhi-wfs-aviso.388_2_2026.decimated.geojson",
    );
    const helada = normalizeWfs(collection, row388, hash);
    const friaje = normalizeWfs(
      collection,
      {
        ...row388,
        title:
          "DESCENSO DE TEMPERATURA DIURNA EN LA SELVA - CUARTO FRIAJE",
      },
      hash,
    );
    const target = subscriber(-74.97, -12.79, 3);
    const heladaDecision = decision([helada], target);
    const friajeDecision = decision([friaje], target);

    expect(helada.hazard).toBe("HELADA");
    expect(friaje.hazard).toBe("FRIAJE");
    expect(
      render(heladaDecision.template!, {
        COLOR: "NARANJA",
        fechas: heladaDecision.fechas!,
        lugar: "HUANCAVELICA",
        nro: 388,
        link: "d111111abcdef8.cloudfront.net/c/K7P2QX",
      }),
    ).toContain("heladas");
    expect(
      render(friajeDecision.template!, {
        COLOR: "NARANJA",
        fechas: friajeDecision.fechas!,
        lugar: "HUANCAVELICA",
        nro: 388,
        link: "d111111abcdef8.cloudfront.net/c/K7P2QX",
      }),
    ).toContain("friaje y lluvias");
  });

  it("trap_escalation_only_up: mismo nivel y nivel menor no envían; nivel mayor usa SUBE_NIVEL", () => {
    const same = decision([w388_2], subscriber(-74.97, -12.79, 2), {
      alreadySentLevels: [3],
    });
    const lower = decision([w388_2], subscriber(-70.02, -15.84, 2), {
      alreadySentLevels: [3],
    });
    const higher = decision([w388_2], subscriber(-74.97, -12.79, 2), {
      alreadySentLevels: [2],
    });

    expect(same).toMatchObject({
      send: false,
      level: 3,
      reason: "already_sent",
    });
    expect(lower).toMatchObject({
      send: false,
      level: 2,
      reason: "lower_than_sent",
    });
    expect(higher).toMatchObject({
      send: true,
      level: 3,
      template: "SUBE_NIVEL",
    });
  });
});

describe("plantillas y validador", () => {
  it("15: renderiza todas las plantillas en un segmento GSM-7", () => {
    for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
      const text = render(id, {
        COLOR: "AMARILLO",
        fechas: "30/09-02/10",
        lugar: "LUGAR MUY LARGO DE 18",
        tmin: -12,
        nro: 388,
        link: "d111111abcdef8.cloudfront.net/c/K7P2QX",
      });
      expect(text.length, id).toBeLessThanOrEqual(160);
    }
  });

  it("16-17: rechaza número inventado y color ausente", () => {
    const facts = {
      COLOR: "NARANJA",
      fechas: "30/09-01/10",
      lugar: "CHARACATO",
      tmin: -12,
      maxBodyLength: 120,
    };
    expect(
      validateRewrite("SENAMHI NARANJA 30/09-01/10: minima -20C", facts),
    ).toMatchObject({ ok: false, reason: "invented_number" });
    expect(
      validateRewrite("SENAMHI 30/09-01/10: minima -12C", facts),
    ).toMatchObject({ ok: false, reason: "missing_color" });
  });

  it("rechaza URL, frase prohibida y longitud; acepta una reescritura válida", () => {
    const facts = {
      COLOR: "NARANJA",
      fechas: "30/09-01/10",
      lugar: "PUNO",
      nro: 388,
      maxBodyLength: 80,
    };
    expect(
      validateRewrite("SENAMHI NARANJA 30/09-01/10 vea https://x.pe", facts),
    ).toMatchObject({ reason: "contains_url" });
    expect(
      validateRewrite("SENAMHI NARANJA 30/09-01/10: no hay peligro", facts),
    ).toMatchObject({ reason: "forbidden_phrase" });
    expect(
      validateRewrite(`SENAMHI NARANJA 30/09-01/10 ${"x".repeat(80)}`, facts),
    ).toMatchObject({ reason: "too_long" });
    expect(
      validateRewrite("SENAMHI NARANJA 30/09-01/10 aviso 388", facts),
    ).toEqual({ ok: true, text: "SENAMHI NARANJA 30/09-01/10 aviso 388" });
  });

  it("normaliza puntuación Unicode y cuenta segmentos largos", () => {
    expect(sanitizeToGsm7("“Alerta” — frío… 🧊")).toBe('"Alerta" - frio... ');
    expect(segments("x".repeat(161))).toEqual({ encoding: "GSM7", count: 2 });
    expect(segments("🧊".repeat(71))).toEqual({ encoding: "UCS2", count: 2 });
  });

  it("render falla si faltan variables y el resultado excede 160", () => {
    expect(() =>
      render("HELADA", {
        COLOR: "AMARILLO",
        fechas: "30/09-02/10",
        lugar: "X".repeat(18),
        tmin: -12,
        link: "x".repeat(100),
      }),
    ).toThrow("supera 160");
  });
});

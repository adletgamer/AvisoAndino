import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  clearIngestState,
  createIngestHandler,
  type IngestDependencies,
} from "../src/handler.js";
import { parseAvisoList } from "../src/senamhiList.js";
import { fetchAvisoMap } from "../src/senamhiWfs.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);
const fixtureText = (name: string) =>
  readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8");
const fixture = (
  name: string,
): FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>> =>
  JSON.parse(fixtureText(name)) as FeatureCollection<
    Polygon | MultiPolygon,
    Record<string, unknown>
  >;

const activeRow = {
  nro: 388,
  year: 2026,
  status: "emitido" as const,
  title: "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
  emision: "2026-09-28",
  inicio: "2026-09-30",
  fin: "2026-10-02",
  color: "NARANJA" as const,
};

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  sqsMock.reset();
  process.env.WARNINGS_TABLE = "Warnings";
  process.env.SNAPSHOTS_BUCKET = "snapshots";
  process.env.MATCH_QUEUE_URL = "https://sqs.example/match";
  delete process.env.DELIVERIES_TABLE;
  delete process.env.SEND_QUEUE_URL;
  clearIngestState();
  ddbMock.on(PutCommand).resolves({});
  s3Mock.on(PutObjectCommand).resolves({});
  sqsMock.on(SendMessageCommand).resolves({ MessageId: "m1" });
});

function dependencies(
  overrides: Partial<IngestDependencies> = {},
): IngestDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    s3: new S3Client({}),
    sqs: new SQSClient({}),
    fetchList: vi.fn().mockResolvedValue([activeRow]),
    fetchMap: vi.fn(async (_nro, mapa) =>
      mapa === 1
        ? fixture("senamhi-wfs-aviso.388_1_2026.decimated.geojson")
        : null,
    ),
    fetchFallback: vi
      .fn()
      .mockResolvedValue(
        fixture("indeci-layer5-avisopp24h.2026-09-28.simplified.geojson"),
      ),
    now: () => new Date("2026-09-29T00:00:00Z"),
    hash: () => "hash-1",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as IngestDependencies["log"],
    metric: vi.fn(),
    ...overrides,
  };
}

describe("lista SENAMHI y cliente WFS", () => {
  it("parsea 388..380 y conserva estados/año/color", () => {
    const rows = parseAvisoList(
      fixtureText("senamhi-avisos-list.2026-09-28.trimmed.html"),
    );
    expect(rows.slice(0, 9).map((row) => row.nro)).toEqual([
      388, 387, 386, 385, 384, 383, 382, 381, 380,
    ]);
    expect(rows.find((row) => row.nro === 388)).toMatchObject({
      status: "emitido",
      year: 2026,
      color: "NARANJA",
    });
    expect(rows.find((row) => row.nro === 384)?.status).toBe("vigente");
    expect(rows.find((row) => row.nro === 380)?.status).toBe("vigente");
    expect(rows.find((row) => row.nro === 379)?.status).toBe("vencido");
  });

  it("reintenta WFS y devuelve null con cero features", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporal"))
      .mockResolvedValue(
        new Response(
          JSON.stringify({ type: "FeatureCollection", features: [] }),
          { status: 200 },
        ),
      );
    await expect(
      fetchAvisoMap(388, 3, 2026, {
        fetch: fetcher,
        sleep: async () => undefined,
        random: () => 0,
      }),
    ).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("handler de ingesta idempotente", () => {
  it("nuevo: guarda snapshot, warning y encola matching", async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await createIngestHandler(dependencies())({});
    expect(result).toMatchObject({
      warningsNew: 1,
      warningsChanged: 0,
      source: "SENAMHI_WFS",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });

  it("igual: no escribe ni encola", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { warningId: "SENAMHI#2026#388#1", contentHash: "sha256:hash-1" },
    });
    const result = await createIngestHandler(dependencies())({});
    expect(result).toMatchObject({ warningsNew: 0, warningsChanged: 0 });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it("cambiado: conserva firstSeenAt y vuelve a encolar", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        warningId: "SENAMHI#2026#388#1",
        contentHash: "sha256:old",
        firstSeenAt: "2026-09-28T00:00:00Z",
      },
    });
    const result = await createIngestHandler(dependencies())({});
    expect(result.warningsChanged).toBe(1);
    const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(item?.firstSeenAt).toBe("2026-09-28T00:00:00Z");
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });

  it("lista caída: usa INDECI y registra fallback", async () => {
    ddbMock.on(GetCommand).resolves({});
    const deps = dependencies({
      fetchList: vi.fn().mockRejectedValue(new Error("SENAMHI caído")),
    });
    const result = await createIngestHandler(deps)({});
    expect(result).toMatchObject({ source: "INDECI_PP24H", warningsNew: 1 });
    expect(deps.fetchFallback).toHaveBeenCalledOnce();
    expect(deps.log.warn).toHaveBeenCalledWith(
      "fallback_indeci",
      expect.any(Object),
    );
  });

  it("activa fallback tras dos listas consecutivas sin avisos activos", async () => {
    ddbMock.on(GetCommand).resolves({});
    const deps = dependencies({ fetchList: vi.fn().mockResolvedValue([]) });
    const handler = createIngestHandler(deps);
    await expect(handler({})).resolves.toMatchObject({
      avisosActivos: 0,
      source: "SENAMHI_WFS",
    });
    await expect(handler({})).resolves.toMatchObject({
      avisosActivos: 1,
      source: "INDECI_PP24H",
    });
    expect(deps.fetchFallback).toHaveBeenCalledOnce();
  });

  it("reencola deliveries programadas cuando vence scheduleAt", async () => {
    process.env.DELIVERIES_TABLE = "Deliveries";
    process.env.SEND_QUEUE_URL = "https://sqs.example/send";
    ddbMock
      .on(ScanCommand)
      .resolves({ Items: [{ deliveryId: "D-SCHEDULED" }] });
    ddbMock.on(UpdateCommand).resolves({});
    const deps = dependencies({ fetchMap: vi.fn().mockResolvedValue(null) });
    await createIngestHandler(deps)({});
    const message = sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input;
    expect(JSON.parse(message?.MessageBody ?? "{}")).toEqual({
      deliveryId: "D-SCHEDULED",
    });
  });
});

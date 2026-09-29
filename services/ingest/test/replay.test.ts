import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { createIngestHandler, type IngestDependencies } from "../src/handler.js";
import { loadListRow, loadMap } from "../src/replaySnapshots.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  sqsMock.reset();
  process.env.WARNINGS_TABLE = "Warnings";
  process.env.SNAPSHOTS_BUCKET = "snapshots";
  process.env.MATCH_QUEUE_URL = "https://sqs.example/match";
  ddbMock.on(GetCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  s3Mock.on(PutObjectCommand).resolves({});
  sqsMock.on(SendMessageCommand).resolves({ MessageId: "m1" });
});

function dependencies(overrides: Partial<IngestDependencies> = {}): IngestDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    s3: new S3Client({}),
    sqs: new SQSClient({}),
    fetchList: vi.fn().mockRejectedValue(new Error("no debe llamarse")),
    fetchMap: vi.fn().mockRejectedValue(new Error("no debe llamarse")),
    fetchFallback: vi.fn(),
    loadReplayRow: (nro, year) => loadListRow(nro, year),
    loadReplayMap: (nro, mapa, year) => loadMap(nro, mapa, year),
    now: () => new Date("2026-09-29T03:00:00Z"),
    hash: () => "abc",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as IngestDependencies["log"],
    metric: vi.fn(),
    ...overrides,
  };
}

describe("replay del aviso 230 (snapshot real)", () => {
  it("la fila oficial guardada da título, color y fechas reales", () => {
    expect(loadListRow(230, 2026)).toEqual({
      nro: 230,
      year: 2026,
      status: "vencido",
      title: "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
      emision: "2026-06-11",
      inicio: "2026-06-13",
      fin: "2026-06-14",
      color: "ROJO",
    });
  });

  it("persiste el warning con prefijo del run, sin activeFlag, y lo encola", async () => {
    const deps = dependencies();
    const result = await createIngestHandler(deps)({
      mode: "replay",
      year: 2026,
      nroAviso: 230,
      runId: "R-1",
      targets: ["DEMO-IE40383"],
      realSmsTargets: [],
      startedAt: "2026-09-29T02:59:59Z",
    });
    expect(result).toMatchObject({ source: "REPLAY", warningsNew: 1 });
    expect(deps.fetchMap).not.toHaveBeenCalled();
    const item = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item).toMatchObject({
      warningId: "REPLAY#R-1#SENAMHI#2026#230#1",
      avisoKey: "REPLAY#R-1#SENAMHI#2026#230",
      source: "REPLAY",
      title: "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
      listLevelColor: "ROJO",
      fechaEmi: "2026-06-11",
      fechIni: "2026-06-13T05:00:00Z",
      hazard: "HELADA",
      maxLevel: 4,
      replayRunId: "R-1",
      replayTargets: ["DEMO-IE40383"],
      simulatedNow: "2026-06-11T17:00:00.000Z",
      replayDataSource: "snapshot",
    });
    expect(item).not.toHaveProperty("activeFlag");
    expect(s3Mock.commandCalls(PutObjectCommand)[0]!.args[0].input.Key).toMatch(/^replay\/R-1\/2026\/230_1\//);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });

  it("sin snapshot local usa la fuente oficial y falla si el aviso no existe (nunca inventa)", async () => {
    const deps = dependencies({
      loadReplayRow: () => undefined,
      fetchList: vi.fn().mockResolvedValue([]),
    });
    await expect(
      createIngestHandler(deps)({ mode: "replay", year: 2025, nroAviso: 200, runId: "R-2" }),
    ).rejects.toThrow(/lista oficial/);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

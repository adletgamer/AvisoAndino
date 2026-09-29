import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  createMatcherHandler,
  type MatcherDependencies,
} from "../src/handler.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);
const geojson = readFileSync(
  new URL(
    "../../../fixtures/senamhi-wfs-aviso.388_2_2026.decimated.geojson",
    import.meta.url,
  ),
);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  sqsMock.reset();
  Object.assign(process.env, {
    WARNINGS_TABLE: "Warnings",
    SUBSCRIBERS_TABLE: "Subscribers",
    DELIVERIES_TABLE: "Deliveries",
    STATS_TABLE: "Stats",
    SNAPSHOTS_BUCKET: "snapshots",
    SEND_QUEUE_URL: "https://sqs.example/send",
    PUBLIC_BASE_URL: "https://d111111abcdef8.cloudfront.net",
  });
  ddbMock.on(UpdateCommand).resolves({});
  sqsMock.on(SendMessageCommand).resolves({ MessageId: "queued" });
  s3Mock.on(GetObjectCommand).resolves({
    Body: { transformToByteArray: async () => gzipSync(geojson) },
  } as never);
});

function sqsEvent(body: string) {
  return {
    Records: [
      {
        messageId: "m1",
        receiptHandle: "r",
        body,
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "0",
          SenderId: "test",
          ApproximateFirstReceiveTimestamp: "0",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-1:123:q",
        awsRegion: "us-east-1",
      },
    ],
  };
}

function deps(): MatcherDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    s3: new S3Client({}),
    sqs: new SQSClient({}),
    now: () => new Date("2026-09-29T18:00:00Z"),
    confirmCode: () => "K7P2QX",
    getTmin: vi.fn().mockResolvedValue(-9),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as MatcherDependencies["log"],
  };
}

function mockReadModel(source: "SENAMHI_WFS" | "REPLAY" = "SENAMHI_WFS") {
  const warning = {
    warningId:
      source === "REPLAY"
        ? "REPLAY#R1#SENAMHI#2026#388#2"
        : "SENAMHI#2026#388#2",
    avisoKey:
      source === "REPLAY" ? "REPLAY#R1#SENAMHI#2026#388" : "SENAMHI#2026#388",
    source,
    replayRunId: source === "REPLAY" ? "R1" : undefined,
    year: 2026,
    nroAviso: 388,
    mapa: 2,
    codFen: 7,
    hazard: "HELADA",
    title: "DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA CENTRO Y SUR",
    fechaEmi: "2026-09-28",
    fechIni: "2026-10-01T05:00:00Z",
    fechFin: "2026-10-02T04:59:59Z",
    contentHash: "sha256:x",
    s3Key: "snapshot.geojson.gz",
    listLevelColor: "NARANJA",
  };
  ddbMock.on(GetCommand).callsFake((input) => {
    if (input.TableName === "Warnings") return { Item: warning };
    return { Item: { smsSent: 0 } };
  });
  ddbMock.on(QueryCommand).callsFake((input) => {
    if (input.TableName === "Warnings") return { Items: [warning] };
    if (input.TableName === "Subscribers") {
      return {
        Items: [
          {
            subscriberId: "S1",
            status: "ACTIVE",
            channel: "SMS",
            lat: -12.79,
            lon: -74.97,
            centroPoblado: "HUANCAVELICA",
            minLevel: 3,
            hazards: ["HELADA"],
            isDemo: source === "REPLAY",
          },
        ],
      };
    }
    return { Items: [] };
  });
  ddbMock.on(BatchGetCommand).resolves({ Responses: { Deliveries: [] } });
}

describe("matcher", () => {
  it("trap_delivery_key_includes_level: crea la clave determinista con sufijo L<nivel>", async () => {
    mockReadModel();
    ddbMock.on(PutCommand).resolves({});
    const result = await createMatcherHandler(deps())(
      sqsEvent('{"warningId":"SENAMHI#2026#388#2"}'),
    );
    expect(result.batchItemFailures).toEqual([]);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
    const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(item).toMatchObject({
      deliveryId: "S1#2026#388#L3",
      channel: "SMS",
      template: "HELADA",
      status: "PENDING",
    });
    expect(item?.deliveryId).not.toBe("S1#2026#388");
  });

  it("trap_escalation_delivery_key: un L2 previo permite una nueva delivery L3 SUBE_NIVEL", async () => {
    mockReadModel();
    ddbMock.on(BatchGetCommand).resolves({
      Responses: {
        Deliveries: [
          {
            deliveryId: "S1#2026#388#L2",
            level: 2,
            status: "SENT",
          },
        ],
      },
    });
    ddbMock.on(PutCommand).resolves({});

    await createMatcherHandler(deps())(
      sqsEvent('{"warningId":"SENAMHI#2026#388#2"}'),
    );

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      deliveryId: "S1#2026#388#L3",
      level: 3,
      template: "SUBE_NIVEL",
    });
  });

  it("ConditionalCheckFailed se trata como dedupe exitoso", async () => {
    mockReadModel();
    ddbMock.on(PutCommand).rejects(
      Object.assign(new Error("duplicado"), {
        name: "ConditionalCheckFailedException",
      }),
    );
    const result = await createMatcherHandler(deps())(
      sqsEvent('{"warningId":"SENAMHI#2026#388#2"}'),
    );
    expect(result.batchItemFailures).toEqual([]);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it("replay fuerza canal SIMULATED y una clave aislada por run", async () => {
    mockReadModel("REPLAY");
    ddbMock.on(PutCommand).resolves({});
    await createMatcherHandler(deps())(
      sqsEvent('{"warningId":"REPLAY#R1#SENAMHI#2026#388#2"}'),
    );
    const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(item).toMatchObject({
      deliveryId: "S1#REPLAY#R1#2026#388#L3",
      channel: "SIMULATED",
      runId: "REPLAY#R1",
    });
  });

  it("mensaje inválido devuelve fallo parcial sin tocar AWS", async () => {
    const result = await createMatcherHandler(deps())(sqsEvent("{}"));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

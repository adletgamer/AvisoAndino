import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createApiHandler, type ApiDependencies } from "../src/handler.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const ssmMock = mockClient(SSMClient);

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  process.env.DELIVERIES_TABLE = "Deliveries";
  process.env.SUBSCRIBERS_TABLE = "Subscribers";
  process.env.STATS_TABLE = "Stats";
  process.env.SSM_PREFIX = "/aviso-andino/test";
  ddbMock.on(UpdateCommand).resolves({});
  ssmMock
    .on(GetParameterCommand)
    .resolves({ Parameter: { Value: "webhook-secret" } });
});

function dependencies(): ApiDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    ssm: new SSMClient({}),
    now: () => new Date("2026-09-29T15:00:00Z"),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as ApiDependencies["log"],
  };
}

function event(
  routeKey: string,
  options: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey,
    rawPath: "/",
    rawQueryString: "",
    headers: {},
    requestContext: {} as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...options,
  };
}

function responseBody(
  response: Awaited<ReturnType<ReturnType<typeof createApiHandler>>>,
): Record<string, unknown> {
  return JSON.parse(
    typeof response === "string" ? response : (response.body ?? "{}"),
  ) as Record<string, unknown>;
}

describe("caso 21: confirmación por enlace", () => {
  it("GET muestra y no confirma; POST confirma una sola vez", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          deliveryId: "D1",
          confirmCode: "K7P2QX",
          runId: "LIVE",
          level: 3,
          color: "NARANJA",
          hazard: "HELADA",
        },
      ],
    });
    const handler = createApiHandler(dependencies());
    const get = await handler(
      event("GET /confirm/{code}", { pathParameters: { code: "K7P2QX" } }),
    );
    expect(get).toMatchObject({ statusCode: 200 });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);

    const post = await handler(
      event("POST /confirm", { body: '{"code":"K7P2QX"}' }),
    );
    expect(responseBody(post)).toMatchObject({
      confirmed: true,
      firstTime: true,
    });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);

    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          deliveryId: "D1",
          confirmCode: "K7P2QX",
          runId: "LIVE",
          confirmedAt: "2026-09-29T15:00:00Z",
        },
      ],
    });
    const second = await handler(
      event("POST /confirm", { body: '{"code":"K7P2QX"}' }),
    );
    expect(responseBody(second)).toMatchObject({
      confirmed: true,
      firstTime: false,
    });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
  });
});

describe("caso 22: Telegram", () => {
  it.each(["Sí", "1", "si "])(
    '"%s" confirma la última delivery pendiente',
    async (text) => {
      ddbMock.on(QueryCommand).callsFake((input) => {
        if (input.IndexName === "byTelegramChat")
          return { Items: [{ subscriberId: "S1" }] };
        if (input.IndexName === "bySubscriber")
          return {
            Items: [
              { confirmCode: "K7P2QX", createdAt: "2026-09-29T14:00:00Z" },
            ],
          };
        return {
          Items: [{ deliveryId: "D1", confirmCode: "K7P2QX", runId: "LIVE" }],
        };
      });
      const response = await createApiHandler(dependencies())(
        event("POST /telegram/webhook", {
          headers: { "x-telegram-bot-api-secret-token": "webhook-secret" },
          body: JSON.stringify({ message: { text, chat: { id: 123 } } }),
        }),
      );
      expect(response).toMatchObject({ statusCode: 200 });
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
    },
  );

  it("rechaza secret token incorrecto con 401", async () => {
    const response = await createApiHandler(dependencies())(
      event("POST /telegram/webhook", {
        headers: { "x-telegram-bot-api-secret-token": "incorrecto" },
        body: "{}",
      }),
    );
    expect(response).toMatchObject({ statusCode: 401 });
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

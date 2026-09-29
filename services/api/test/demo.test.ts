import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { decryptPhone } from "@aviso/core/src/phoneCrypto.js";
import { createApiHandler, type ApiDependencies } from "../src/handler.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const ssmMock = mockClient(SSMClient);
const lambdaMock = mockClient(LambdaClient);
const KEY = Buffer.alloc(32, 3).toString("base64");
const DEMO_KEY = "demo-key-0123456789abcdef";

function params(extra: Record<string, string> = {}) {
  const values: Record<string, string> = {
    "secrets/phoneHmacKey": KEY,
    "secrets/phoneEncKey": KEY,
    "sms/allowlist": '["+51912345678"]',
    "replay/allowlist": '["2026-230"]',
    "replay/demoKey": DEMO_KEY,
    SMS_ENABLED: "false",
    ...extra,
  };
  ssmMock.on(GetParametersCommand).callsFake((input: { Names: string[] }) => ({
    Parameters: input.Names.filter((name) => values[name.replace("/aviso-andino/test/", "")] !== undefined).map(
      (name) => ({ Name: name, Value: values[name.replace("/aviso-andino/test/", "")] }),
    ),
  }));
}

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  lambdaMock.reset();
  Object.assign(process.env, {
    DELIVERIES_TABLE: "Deliveries",
    SUBSCRIBERS_TABLE: "Subscribers",
    STATS_TABLE: "Stats",
    WARNINGS_TABLE: "Warnings",
    SSM_PREFIX: "/aviso-andino/test",
    INGEST_FUNCTION_NAME: "ingest-fn",
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(GetCommand).resolves({});
  lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
  params();
});

function deps(): ApiDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    ssm: new SSMClient({}),
    lambda: new LambdaClient({}),
    now: () => new Date("2026-09-29T15:00:00Z"),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ApiDependencies["log"],
  };
}

function post(routeKey: string, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey,
    rawPath: "/",
    rawQueryString: "",
    headers,
    body: JSON.stringify(body),
    requestContext: {} as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
  };
}

const location = { lat: -15.73, lon: -72.108, centroPoblado: "HUAMBO", departamento: "AREQUIPA" };

async function call(event: APIGatewayProxyEventV2) {
  const response = (await createApiHandler(deps())(event)) as { statusCode: number; body: string };
  return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, any> };
}

describe("POST /api/subscribers", () => {
  it("solo simulación: ACTIVE, isDemo y sin teléfono", async () => {
    const res = await call(post("POST /api/subscribers", { channel: "SIMULATED", location, consent: true }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "ACTIVE", simulationOnly: true, next: { type: "NONE" } });
    expect(res.body.subscriberId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const item = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item).toMatchObject({ channel: "SIMULATED", isDemo: true, consentVersion: "v1", minLevel: 3 });
    expect(item).not.toHaveProperty("phoneEnc");
  });

  it("valida consentimiento y honeypot", async () => {
    expect((await call(post("POST /api/subscribers", { channel: "SIMULATED", location, consent: false }))).status).toBe(400);
    expect(
      (await call(post("POST /api/subscribers", { channel: "SIMULATED", location, consent: true, website: "spam" }))).status,
    ).toBe(400);
  });

  it("SMS a un número no verificado responde 422 y no guarda nada", async () => {
    const res = await call(post("POST /api/subscribers", { channel: "SMS", phone: "+51987654321", location, consent: true }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("SMS_NOT_AVAILABLE");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("SMS verificado: guarda hash + cifrado + máscara, nunca el número en claro", async () => {
    const res = await call(post("POST /api/subscribers", { channel: "SMS", phone: "+51912345678", location, consent: true }));
    expect(res.status).toBe(201);
    expect(res.body.phoneMasked).toBe("+51 9•••••678");
    const item = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(JSON.stringify(item)).not.toContain("912345678");
    expect(item.phoneHash).toMatch(/^hmac256:/);
    expect(decryptPhone(item.phoneEnc as string, KEY)).toBe("+51912345678");
  });

  it("teléfono duplicado responde 409", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ subscriberId: "X" }] });
    const res = await call(post("POST /api/subscribers", { channel: "SMS", phone: "+51912345678", location, consent: true }));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/replay", () => {
  it("público: solo simulación, invoca ingest con el demo seed", async () => {
    const res = await call(post("POST /api/replay", { year: 2026, nroAviso: 230 }));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "RUNNING", mode: "SIMULATION" });
    const payload = JSON.parse(Buffer.from(lambdaMock.commandCalls(InvokeCommand)[0]!.args[0].input.Payload as Uint8Array).toString());
    expect(payload).toMatchObject({ mode: "replay", nroAviso: 230, targets: ["DEMO-IE40383"], realSmsTargets: [] });
    expect(lambdaMock.commandCalls(InvokeCommand)[0]!.args[0].input.InvocationType).toBe("Event");
  });

  it("aviso fuera de la allowlist: 403", async () => {
    const res = await call(post("POST /api/replay", { year: 2026, nroAviso: 999 }));
    expect(res.status).toBe(403);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it("SMS real sin clave o con clave incorrecta: 403", async () => {
    const id = "01J9Z3V6M8Q2K4T7B1N5R0C9XD";
    expect((await call(post("POST /api/replay", { year: 2026, nroAviso: 230, realSmsSubscriberId: id }))).status).toBe(403);
    expect(
      (await call(post("POST /api/replay", { year: 2026, nroAviso: 230, realSmsSubscriberId: id }, { "x-demo-key": "nope" })))
        .status,
    ).toBe(403);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it("con clave válida incluye al suscriptor SMS como realSmsTarget", async () => {
    const id = "01J9Z3V6M8Q2K4T7B1N5R0C9XD";
    ddbMock.on(GetCommand).callsFake((input) =>
      input.Key?.subscriberId === id ? { Item: { subscriberId: id, channel: "SMS", status: "ACTIVE" } } : {},
    );
    const res = await call(
      post("POST /api/replay", { year: 2026, nroAviso: 230, realSmsSubscriberId: id }, { "X-Demo-Key": DEMO_KEY }),
    );
    expect(res.status).toBe(202);
    expect(res.body.mode).toBe("REAL_SMS");
    const payload = JSON.parse(Buffer.from(lambdaMock.commandCalls(InvokeCommand)[0]!.args[0].input.Payload as Uint8Array).toString());
    expect(payload.realSmsTargets).toEqual([id]);
  });

  it("tope diario público: 429", async () => {
    ddbMock.on(UpdateCommand).rejects(Object.assign(new Error("cap"), { name: "ConditionalCheckFailedException" }));
    const res = await call(post("POST /api/replay", { year: 2026, nroAviso: 230 }));
    expect(res.status).toBe(429);
  });
});

describe("GET /api/panel", () => {
  it("sin datos devuelve ceros/nulos reales (sin números inventados)", async () => {
    const response = (await createApiHandler(deps())({
      ...post("GET /api/panel", undefined),
      body: undefined,
    })) as { statusCode: number; body: string };
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.production).toMatchObject({ sent: 0, confirmed: 0, confirmedPct: null });
    expect(body.production.latency.publicationToSendMin).toBeNull();
    expect(body.replay).toMatchObject({ runsShown: 0, sent: 0, confirmedPct: null });
    expect(body.warning).toBeNull();
  });
});

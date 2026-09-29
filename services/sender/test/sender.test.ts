import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
import { encryptPhone } from "@aviso/core/src/phoneCrypto.js";
import {
  clearSenderConfigCache,
  createSenderHandler,
  type SenderDependencies,
} from "../src/handler.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const smsMock = mockClient(PinpointSMSVoiceV2Client);
const ssmMock = mockClient(SSMClient);
const kmsMock = mockClient(KMSClient);

beforeEach(() => {
  clearSenderConfigCache();
  ddbMock.reset();
  smsMock.reset();
  ssmMock.reset();
  kmsMock.reset();
  process.env.DELIVERIES_TABLE = "Deliveries";
  process.env.SUBSCRIBERS_TABLE = "Subscribers";
  process.env.STATS_TABLE = "Stats";
  process.env.SSM_PREFIX = "/aviso-andino/test";
  process.env.SMS_CONFIGURATION_SET = "aviso-andino";
  ddbMock.on(UpdateCommand).resolves({});
});

function event(deliveryId = "D1") {
  return {
    Records: [
      {
        messageId: "m1",
        receiptHandle: "r",
        body: JSON.stringify({ deliveryId }),
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

function deps(): SenderDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    sms: new PinpointSMSVoiceV2Client({}),
    ssm: new SSMClient({}),
    kms: new KMSClient({}),
    fetch: vi.fn(),
    now: () => new Date("2026-09-29T15:00:10Z"),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as SenderDependencies["log"],
  };
}

const ENC_KEY = Buffer.alloc(32, 7).toString("base64");

function mockRecords(runId = "LIVE", extra: Record<string, unknown> = {}, phoneEnc?: string) {
  ddbMock.on(GetCommand).callsFake((input) => {
    if (input.TableName === "Deliveries") {
      return {
        Item: {
          deliveryId: "D1",
          subscriberId: "S1",
          runId,
          channel: "SMS",
          text: "SENAMHI NARANJA: aviso. Confirme: ejemplo.net/c/K7P2QX",
          status: "PENDING",
          createdAt: "2026-09-29T15:00:00Z",
          ...extra,
        },
      };
    }
    if (input.TableName === "Subscribers") {
      return {
        Item: {
          subscriberId: "S1",
          phoneHash: "hash1",
          phoneEnc: phoneEnc ?? `kms:${Buffer.from("cipher").toString("base64")}`,
        },
      };
    }
    return { Item: { smsSent: 0 } };
  });
}

function mockConfig(enabled: boolean, allowlist = '["+51912345678"]') {
  ssmMock.on(GetParametersCommand).resolves({
    Parameters: [
      { Name: "/aviso-andino/test/SMS_ENABLED", Value: String(enabled) },
      { Name: "/aviso-andino/test/SMS_DAILY_CAP", Value: "30" },
      { Name: "/aviso-andino/test/SMS_MAX_PRICE", Value: "0.30" },
      { Name: "/aviso-andino/test/sms/allowlist", Value: allowlist },
      { Name: "/aviso-andino/test/secrets/phoneEncKey", Value: ENC_KEY },
    ],
  });
}

describe("sender seguro e idempotente", () => {
  it("con SMS_ENABLED=false degrada a SIMULATED y nunca llama SMS", async () => {
    mockRecords();
    mockConfig(false);
    const response = await createSenderHandler(deps())(event());
    expect(response.batchItemFailures).toEqual([]);
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
    const transition = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(transition.ExpressionAttributeValues?.[":channel"]).toBe(
      "SIMULATED",
    );
    expect(transition.ExpressionAttributeValues?.[":reason"]).toBe(
      "SMS_DISABLED",
    );
  });

  it("un replay nunca envía SMS aunque el flag esté activo", async () => {
    mockRecords("REPLAY#R1");
    mockConfig(true);
    await createSenderHandler(deps())(event());
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
    const transition = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(transition.ExpressionAttributeValues?.[":reason"]).toBe(
      "REPLAY_FORCED_SIMULATED",
    );
  });

  it("SMS habilitado usa SendTextMessage sin OriginationIdentity", async () => {
    mockRecords();
    mockConfig(true);
    kmsMock
      .on(DecryptCommand)
      .resolves({ Plaintext: new TextEncoder().encode("+51912345678") });
    smsMock.on(SendTextMessageCommand).resolves({ MessageId: "aws-message-1" });
    await createSenderHandler(deps())(event());
    const calls = smsMock.commandCalls(SendTextMessageCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toMatchObject({
      DestinationPhoneNumber: "+51912345678",
      MessageType: "TRANSACTIONAL",
      ConfigurationSetName: "aviso-andino",
      MaxPrice: "0.30",
      Context: { deliveryId: "D1" },
    });
    expect(calls[0]?.args[0].input).not.toHaveProperty("OriginationIdentity");
  });

  it("rechaza cualquier destino fuera de la allowlist E.164 exacta", async () => {
    mockRecords();
    mockConfig(true, '["+51900000001"]');
    kmsMock
      .on(DecryptCommand)
      .resolves({ Plaintext: new TextEncoder().encode("+51912345678") });
    await createSenderHandler(deps())(event());
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
    const transition = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(transition.ExpressionAttributeValues?.[":reason"]).toBe("SMS_NOT_ALLOWLISTED");
  });

  it("replay autorizado (allowRealSms) envía un SMS real con phoneEnc aes: al número permitido", async () => {
    mockRecords("REPLAY#R1", { allowRealSms: true }, encryptPhone("+51912345678", ENC_KEY));
    mockConfig(true);
    smsMock.on(SendTextMessageCommand).resolves({ MessageId: "aws-message-2" });
    const response = await createSenderHandler(deps())(event());
    expect(response.batchItemFailures).toEqual([]);
    const calls = smsMock.commandCalls(SendTextMessageCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input.DestinationPhoneNumber).toBe("+51912345678");
    const stats = ddbMock
      .commandCalls(UpdateCommand)
      .map((call) => call.args[0].input.Key)
      .filter((key) => key && "statsPk" in key);
    expect(stats).toContainEqual({ statsPk: "RUN#R1", statsSk: "TOTAL" });
    expect(stats).toContainEqual(expect.objectContaining({ statsPk: "GLOBAL" }));
  });

  it("replay autorizado con SMS_ENABLED=false queda simulado", async () => {
    mockRecords("REPLAY#R1", { allowRealSms: true }, encryptPhone("+51912345678", ENC_KEY));
    mockConfig(false);
    await createSenderHandler(deps())(event());
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
  });

  it("un error de SMS real nunca se reintenta: queda FAILED sin batchItemFailure", async () => {
    mockRecords();
    mockConfig(true);
    kmsMock
      .on(DecryptCommand)
      .resolves({ Plaintext: new TextEncoder().encode("+51912345678") });
    smsMock.on(SendTextMessageCommand).rejects(Object.assign(new Error("throttled"), { name: "ThrottlingException" }));
    const response = await createSenderHandler(deps())(event());
    expect(response.batchItemFailures).toEqual([]);
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(1);
    const failed = ddbMock
      .commandCalls(UpdateCommand)
      .map((call) => call.args[0].input.ExpressionAttributeValues?.[":failed"]);
    expect(failed).toContain("FAILED");
  });

  it("si el evento de entrega llegó antes, el envío no se marca FAILED", async () => {
    mockRecords();
    mockConfig(true);
    kmsMock
      .on(DecryptCommand)
      .resolves({ Plaintext: new TextEncoder().encode("+51912345678") });
    smsMock.on(SendTextMessageCommand).resolves({ MessageId: "aws-message-3" });
    ddbMock.on(UpdateCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues?.[":sent"] === "SENT")
        throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
      return {};
    });
    await createSenderHandler(deps())(event());
    const failed = ddbMock
      .commandCalls(UpdateCommand)
      .map((call) => call.args[0].input.ExpressionAttributeValues?.[":failed"]);
    expect(failed).not.toContain("FAILED");
  });

  it("si ya no está PENDING no procesa otra vez", async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { deliveryId: "D1", status: "SENT" } });
    await createSenderHandler(deps())(event());
    expect(ssmMock.commandCalls(GetParametersCommand)).toHaveLength(0);
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
  });
});

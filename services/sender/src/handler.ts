import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
  type SendTextMessageCommandOutput,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { maskPhone, segments, type Channel } from "@aviso/core";
import { decryptPhone as decryptAesPhone } from "@aviso/core/src/phoneCrypto.js";

const logger = new Logger({ serviceName: "sender" });

export const SMS_PRICE_PE_USD = 0.23252; // prices.json oficial, 28-sep-2026

interface Delivery {
  deliveryId: string;
  subscriberId: string;
  runId: string;
  channel: Channel;
  text: string;
  status: string;
  scheduleAt?: string;
  createdAt: string;
  /** Solo lo pone el matcher en replays autorizados con x-demo-key. */
  allowRealSms?: boolean;
}

interface SubscriberRecord {
  subscriberId: string;
  phoneHash?: string;
  phoneEnc?: string;
  telegramChatId?: string;
}

interface SenderConfig {
  smsEnabled: boolean;
  smsDailyCap: number;
  smsMaxPrice: string;
  /** Números E.164 exactos (sandbox: verificados). Cualquier otro destino se rechaza. */
  smsAllowlist: Set<string>;
  telegramBotToken?: string;
  phoneEncKey?: string;
}

export interface SenderDependencies {
  ddb: DynamoDBDocumentClient;
  sms: PinpointSMSVoiceV2Client;
  ssm: SSMClient;
  kms: KMSClient;
  fetch: typeof fetch;
  now: () => Date;
  log: Pick<Logger, "info" | "warn" | "error">;
}

const defaultDependencies: SenderDependencies = {
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  sms: new PinpointSMSVoiceV2Client({}),
  ssm: new SSMClient({}),
  kms: new KMSClient({}),
  fetch,
  now: () => new Date(),
  log: logger,
};

let configCache: { expiresAt: number; value: SenderConfig } | undefined;

export function clearSenderConfigCache(): void {
  configCache = undefined;
}

export function createSenderHandler(
  deps: SenderDependencies = defaultDependencies,
) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const deliveryId = (parsed as { deliveryId?: unknown }).deliveryId;
        if (typeof deliveryId !== "string" || !deliveryId)
          throw new Error("Mensaje sin deliveryId");
        await processDelivery(deliveryId, deps);
      } catch (error) {
        deps.log.error("send_failed", {
          error: errorMessage(error),
          messageId: record.messageId,
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

export const handler = createSenderHandler();

async function processDelivery(
  deliveryId: string,
  deps: SenderDependencies,
): Promise<void> {
  const deliveryResult = await deps.ddb.send(
    new GetCommand({
      TableName: requiredEnv("DELIVERIES_TABLE"),
      Key: { deliveryId },
      ConsistentRead: true,
    }),
  );
  if (!deliveryResult.Item)
    throw permanent(`Delivery no encontrada: ${deliveryId}`);
  const delivery = deliveryResult.Item as Delivery;
  const now = deps.now();
  if (
    delivery.status === "SCHEDULED" &&
    delivery.scheduleAt &&
    Date.parse(delivery.scheduleAt) > now.getTime()
  ) {
    deps.log.info("delivery_aun_programada", {
      deliveryId,
      scheduleAt: delivery.scheduleAt,
    });
    return;
  }
  if (delivery.status !== "PENDING" && delivery.status !== "SCHEDULED") return;

  const [subscriberResult, config] = await Promise.all([
    deps.ddb.send(
      new GetCommand({
        TableName: requiredEnv("SUBSCRIBERS_TABLE"),
        Key: { subscriberId: delivery.subscriberId },
        ConsistentRead: true,
      }),
    ),
    loadConfig(deps),
  ]);
  if (!subscriberResult.Item) throw permanent("Suscriptor no encontrado");
  const subscriber = subscriberResult.Item as SubscriberRecord;
  let channel = delivery.channel;
  let simulatedReason: string | undefined;
  let phone: string | undefined;
  const isReplay = delivery.runId.startsWith("REPLAY#");
  if (channel === "SMS") {
    if (isReplay && delivery.allowRealSms !== true)
      simulatedReason = "REPLAY_FORCED_SIMULATED";
    else if (!config.smsEnabled) simulatedReason = "SMS_DISABLED";
    else {
      try {
        phone = subscriber.phoneEnc
          ? await decryptPhone(subscriber.phoneEnc, config, deps)
          : undefined;
      } catch (error) {
        deps.log.warn("telefono_no_descifrable", { deliveryId, error: errorMessage(error) });
      }
      if (!phone) simulatedReason = "SMS_PHONE_UNAVAILABLE";
      else if (!config.smsAllowlist.has(phone))
        simulatedReason = "SMS_NOT_ALLOWLISTED";
      else if (await smsCapReached(config.smsDailyCap, now, deps))
        simulatedReason = "SMS_DAILY_CAP";
    }
    if (simulatedReason) {
      channel = "SIMULATED";
      phone = undefined;
    }
  } else if (isReplay && channel !== "SIMULATED") {
    channel = "SIMULATED";
    simulatedReason = "REPLAY_FORCED_SIMULATED";
  }

  try {
    await deps.ddb.send(
      new UpdateCommand({
        TableName: requiredEnv("DELIVERIES_TABLE"),
        Key: { deliveryId },
        UpdateExpression:
          "SET #status = :sending, channel = :channel, simulatedReason = :reason",
        ConditionExpression: "#status IN (:pending, :scheduled)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":sending": "SENDING",
          ":pending": "PENDING",
          ":scheduled": "SCHEDULED",
          ":channel": channel,
          ":reason": simulatedReason ?? "NONE",
        },
      }),
    );
  } catch (error) {
    if (isConditionalFailure(error)) return;
    throw error;
  }

  try {
    const messageId = await sendChannel(
      channel,
      delivery,
      subscriber,
      config,
      deps,
      phone,
    );
    await recordSent(delivery, channel, messageId, simulatedReason, phone, deps);
  } catch (error) {
    // Un SMS real nunca se reintenta (presupuesto sandbox ~1 USD/mes): cualquier error lo deja FAILED.
    if (channel === "SMS" || isPermanentSendError(error)) {
      await markFailed(deliveryId, errorMessage(error), deps);
      return;
    }
    await deps.ddb.send(
      new UpdateCommand({
        TableName: requiredEnv("DELIVERIES_TABLE"),
        Key: { deliveryId },
        UpdateExpression: "SET #status = :pending, lastError = :error",
        ConditionExpression: "#status = :sending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":pending": "PENDING",
          ":sending": "SENDING",
          ":error": errorMessage(error),
        },
      }),
    );
    throw error;
  }
}

/**
 * Contabiliza un envío ya hecho. Nunca lanza hacia el catch de envío: si el mensaje salió,
 * no debe marcarse FAILED ni reintentarse aunque falle la contabilidad.
 */
async function recordSent(
  delivery: Delivery,
  channel: Channel,
  messageId: string,
  simulatedReason: string | undefined,
  phone: string | undefined,
  deps: SenderDependencies,
): Promise<void> {
  const deliveryId = delivery.deliveryId;
  const sentAt = deps.now();
  const smsInfo = segments(delivery.text);
  const values = {
    ":sentAt": sentAt.toISOString(),
    ":messageId": messageId,
    ":segments": smsInfo.count,
    ":encoding": smsInfo.encoding,
    ":latency": Math.max(0, Math.round((sentAt.getTime() - Date.parse(delivery.createdAt)) / 1000)),
    ":reason": simulatedReason ?? "NONE",
    ":dest": phone ? maskPhone(phone) : "SIMULADO",
  };
  const fields =
    "sentAt = :sentAt, messageId = :messageId, segments = :segments, encoding = :encoding, " +
    "latencyDetectToSendSec = :latency, simulatedReason = :reason, destinationMasked = :dest";
  try {
    try {
      await deps.ddb.send(
        new UpdateCommand({
          TableName: requiredEnv("DELIVERIES_TABLE"),
          Key: { deliveryId },
          UpdateExpression: `SET #status = :sent, ${fields}`,
          ConditionExpression: "#status = :sending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ...values, ":sent": "SENT", ":sending": "SENDING" },
        }),
      );
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
      // El evento de End User Messaging llegó antes: conservar su estado y guardar solo los datos.
      await deps.ddb.send(
        new UpdateCommand({
          TableName: requiredEnv("DELIVERIES_TABLE"),
          Key: { deliveryId },
          UpdateExpression: `SET ${fields}`,
          ExpressionAttributeValues: values,
        }),
      );
    }
    await updateStats(channel, delivery.runId, sentAt, deps);
  } catch (error) {
    deps.log.error("contabilidad_envio_fallida", { deliveryId, messageId, error: errorMessage(error) });
  }
  deps.log.info("delivery_enviada", {
    deliveryId,
    subscriberId: delivery.subscriberId,
    channel,
    messageId,
  });
}

async function sendChannel(
  channel: Channel,
  delivery: Delivery,
  subscriber: SubscriberRecord,
  config: SenderConfig,
  deps: SenderDependencies,
  phone?: string,
): Promise<string> {
  if (channel === "SIMULATED") return `simulated:${delivery.deliveryId}`;
  if (channel === "TELEGRAM") {
    if (!config.telegramBotToken || !subscriber.telegramChatId)
      throw permanent("Telegram no configurado");
    const response = await deps.fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: subscriber.telegramChatId,
          text: delivery.text,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "1 ✅ Recibí",
                  callback_data: `ack:${confirmCodeFromText(delivery.text)}`,
                },
              ],
            ],
          },
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        throw permanent(`Telegram HTTP ${response.status}`);
      throw new Error(`Telegram HTTP ${response.status}`);
    }
    const result = (await response.json()) as {
      result?: { message_id?: number };
    };
    return `telegram:${result.result?.message_id ?? "unknown"}`;
  }
  // Última barrera antes de gastar: SMS_ENABLED y destino exacto en la allowlist.
  if (!config.smsEnabled) throw permanent("SMS deshabilitado");
  if (!phone || !config.smsAllowlist.has(phone))
    throw permanent("Destino fuera de la allowlist: SMS rechazado");
  const output: SendTextMessageCommandOutput = await deps.sms.send(
    new SendTextMessageCommand({
      DestinationPhoneNumber: phone,
      MessageBody: delivery.text,
      MessageType: "TRANSACTIONAL",
      ConfigurationSetName: requiredEnv("SMS_CONFIGURATION_SET"),
      MaxPrice: config.smsMaxPrice,
      Context: { deliveryId: delivery.deliveryId },
    }),
  );
  if (!output.MessageId)
    throw new Error("End User Messaging no devolvió MessageId");
  return output.MessageId;
}

async function loadConfig(deps: SenderDependencies): Promise<SenderConfig> {
  const now = deps.now().getTime();
  if (configCache && configCache.expiresAt > now) return configCache.value;
  const prefix = requiredEnv("SSM_PREFIX").replace(/\/$/, "");
  const names = [
    "SMS_ENABLED",
    "SMS_DAILY_CAP",
    "SMS_MAX_PRICE",
    "sms/allowlist",
    "telegram/botToken",
    "secrets/phoneEncKey",
  ].map((name) => `${prefix}/${name}`);
  const response = await deps.ssm.send(
    new GetParametersCommand({ Names: names, WithDecryption: true }),
  );
  const values = new Map(
    response.Parameters?.map((parameter) => [
      parameter.Name,
      parameter.Value ?? "",
    ]),
  );
  const allowlist = safeStringArray(values.get(`${prefix}/sms/allowlist`));
  const value: SenderConfig = {
    smsEnabled: values.get(`${prefix}/SMS_ENABLED`) === "true",
    smsDailyCap: positiveInteger(values.get(`${prefix}/SMS_DAILY_CAP`), 30),
    smsMaxPrice: positiveDecimal(values.get(`${prefix}/SMS_MAX_PRICE`), "0.30"),
    smsAllowlist: new Set(allowlist.filter((entry) => /^\+519\d{8}$/.test(entry))),
    telegramBotToken: values.get(`${prefix}/telegram/botToken`) || undefined,
    phoneEncKey: values.get(`${prefix}/secrets/phoneEncKey`) || undefined,
  };
  configCache = { value, expiresAt: now + 60_000 };
  return value;
}

async function smsCapReached(
  cap: number,
  now: Date,
  deps: SenderDependencies,
): Promise<boolean> {
  const stats = await deps.ddb.send(
    new GetCommand({
      TableName: requiredEnv("STATS_TABLE"),
      Key: { statsPk: "GLOBAL", statsSk: `DAY#${limaDate(now)}` },
      ConsistentRead: true,
    }),
  );
  return (
    (typeof stats.Item?.smsSent === "number" ? stats.Item.smsSent : 0) >= cap
  );
}

async function updateStats(
  channel: Channel,
  runId: string,
  now: Date,
  deps: SenderDependencies,
): Promise<void> {
  const smsCost = channel === "SMS" ? 232_520 : 0;
  const smsSent = channel === "SMS" ? 1 : 0;
  const statsPk =
    runId === "LIVE" ? "GLOBAL" : `RUN#${runId.replace(/^REPLAY#/, "")}`;
  const keys: Array<[string, string]> = [
    [statsPk, "TOTAL"],
    [statsPk, `DAY#${limaDate(now)}`],
  ];
  // El tope diario global de SMS cuenta también los SMS reales enviados desde un replay.
  if (channel === "SMS" && statsPk !== "GLOBAL") keys.push(["GLOBAL", `DAY#${limaDate(now)}`]);
  for (const [pk, statsSk] of keys) {
    const onlySms = pk === "GLOBAL" && statsPk !== "GLOBAL";
    await deps.ddb.send(
      new UpdateCommand({
        TableName: requiredEnv("STATS_TABLE"),
        Key: { statsPk: pk, statsSk },
        UpdateExpression:
          "ADD sent :one, smsSent :smsSent, smsCostMicroUsd :cost SET updatedAt = :now",
        ExpressionAttributeValues: {
          ":one": onlySms ? 0 : 1,
          ":smsSent": smsSent,
          ":cost": smsCost,
          ":now": now.toISOString(),
        },
      }),
    );
  }
}

async function markFailed(
  deliveryId: string,
  reason: string,
  deps: SenderDependencies,
): Promise<void> {
  await deps.ddb.send(
    new UpdateCommand({
      TableName: requiredEnv("DELIVERIES_TABLE"),
      Key: { deliveryId },
      UpdateExpression:
        "SET #status = :failed, failedAt = :now, failureReason = :reason",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":failed": "FAILED",
        ":now": deps.now().toISOString(),
        ":reason": reason,
      },
    }),
  );
}

async function decryptPhone(
  phoneEnc: string,
  config: SenderConfig,
  deps: SenderDependencies,
): Promise<string> {
  if (phoneEnc.startsWith("aes:")) {
    if (!config.phoneEncKey) throw permanent("Falta secrets/phoneEncKey");
    return decryptAesPhone(phoneEnc, config.phoneEncKey);
  }
  if (!phoneEnc.startsWith("kms:"))
    throw permanent("phoneEnc con formato desconocido");
  const response = await deps.kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(phoneEnc.slice(4), "base64"),
    }),
  );
  if (!response.Plaintext) throw permanent("KMS no devolvió el teléfono");
  const phone = Buffer.from(response.Plaintext).toString("utf8");
  if (!/^\+519\d{8}$/.test(phone))
    throw permanent("Teléfono descifrado inválido");
  return phone;
}

function safeStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveDecimal(value: string | undefined, fallback: string): string {
  return value && Number.isFinite(Number(value)) && Number(value) > 0
    ? value
    : fallback;
}

function limaDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function confirmCodeFromText(text: string): string {
  return text.match(/\/c\/([0-9A-HJKMNP-TV-Z]{6})/)?.[1] ?? "UNKNOWN";
}

function permanent(message: string): Error {
  return Object.assign(new Error(message), { permanent: true });
}

function isPermanentSendError(error: unknown): boolean {
  const candidate = error as { permanent?: boolean; name?: string };
  return (
    Boolean(candidate.permanent) ||
    [
      "ValidationException",
      "InvalidParameterException",
      "AccessDeniedException",
    ].includes(candidate.name ?? "")
  );
}

function isConditionalFailure(error: unknown): boolean {
  return (
    (error as { name?: string }).name === "ConditionalCheckFailedException"
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

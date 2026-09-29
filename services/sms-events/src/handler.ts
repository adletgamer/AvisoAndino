// Lambda sms-events: SNS <- ConfigurationSet de End User Messaging
// (TEXT_DELIVERED, TEXT_UNREACHABLE, TEXT_CARRIER_BLOCKED, ...).
// Correlaciona por context.deliveryId. Loguear el primer evento real (sin teléfono) y documentar su formato en RESEARCH.md.
// Futuro: si hay short code PE, procesar respuestas entrantes "1" (confirmar) y "STOP"/"BAJA".
import type { SNSEvent } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const logger = new Logger({ serviceName: "sms-events" });

export interface SmsEventDependencies {
  ddb: DynamoDBDocumentClient;
  now: () => Date;
  log: Pick<Logger, "info" | "warn">;
}

const defaultDependencies: SmsEventDependencies = {
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  now: () => new Date(),
  log: logger,
};

export function createSmsEventsHandler(
  deps: SmsEventDependencies = defaultDependencies,
) {
  return async (event: SNSEvent): Promise<void> => {
    for (const record of event.Records) {
      let payload: unknown;
      try {
        payload = JSON.parse(record.Sns.Message);
      } catch {
        deps.log.warn("sms_event_invalido", {
          snsMessageId: record.Sns.MessageId,
        });
        continue;
      }
      const parsed = parseSmsEvent(payload);
      deps.log.info("sms_event", {
        snsMessageId: record.Sns.MessageId,
        eventType: parsed?.eventType ?? "UNKNOWN",
        deliveryId: parsed?.deliveryId,
      });
      if (!parsed) continue;
      const status = statusFor(parsed.eventType);
      if (!status) continue;
      const now = deps.now().toISOString();
      const details = eventDetails(payload);
      let runId: unknown;
      try {
        const updated = await deps.ddb.send(
          new UpdateCommand({
            TableName: requiredEnv("DELIVERIES_TABLE"),
            Key: { deliveryId: parsed.deliveryId },
            // Nunca retrocede un estado final (p. ej. TEXT_SUCCESSFUL tardío tras TEXT_DELIVERED).
            UpdateExpression:
              "SET #status = :status, providerEventAt = :now, providerEventType = :eventType" +
              (status === "DELIVERED" ? ", deliveredAt = :now" : "") +
              (details.messageStatusDescription ? ", providerStatusDescription = :desc" : "") +
              (details.totalMessagePrice !== undefined ? ", providerPriceUsd = :price" : ""),
            ConditionExpression:
              "attribute_exists(deliveryId) AND (attribute_not_exists(#status) OR NOT #status IN (:delivered, :failed))",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": status,
              ":now": now,
              ":eventType": parsed.eventType,
              ":delivered": "DELIVERED",
              ":failed": "FAILED",
              ...(details.messageStatusDescription ? { ":desc": details.messageStatusDescription } : {}),
              ...(details.totalMessagePrice !== undefined ? { ":price": details.totalMessagePrice } : {}),
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        runId = updated.Attributes?.runId;
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") continue;
        throw error;
      }
      if (status === "DELIVERED" || status === "FAILED") {
        // Métricas separadas: los SMS de un replay cuentan en RUN#<id>, no en producción.
        const statsPk =
          typeof runId === "string" && runId.startsWith("REPLAY#")
            ? `RUN#${runId.slice("REPLAY#".length)}`
            : "GLOBAL";
        await deps.ddb.send(
          new UpdateCommand({
            TableName: requiredEnv("STATS_TABLE"),
            Key: { statsPk, statsSk: "TOTAL" },
            UpdateExpression: `ADD ${status === "DELIVERED" ? "delivered" : "failed"} :one SET updatedAt = :now`,
            ExpressionAttributeValues: {
              ":one": 1,
              ":now": now,
            },
          }),
        );
      }
    }
  };
}

export const handler = createSmsEventsHandler();

export function parseSmsEvent(
  payload: unknown,
): { eventType: string; deliveryId: string } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const object = payload as Record<string, unknown>;
  const eventType = [
    object.eventType,
    object.event_type,
    object.eventTypeName,
  ].find((value): value is string => typeof value === "string");
  const context = (object.context ??
    (object.message as Record<string, unknown> | undefined)?.context) as
    Record<string, unknown> | undefined;
  const deliveryId = context?.deliveryId;
  return eventType && typeof deliveryId === "string"
    ? { eventType, deliveryId }
    : undefined;
}

function eventDetails(payload: unknown): { messageStatusDescription?: string; totalMessagePrice?: number } {
  const object = (payload ?? {}) as Record<string, unknown>;
  return {
    ...(typeof object.messageStatusDescription === "string"
      ? { messageStatusDescription: object.messageStatusDescription.slice(0, 200) }
      : {}),
    ...(typeof object.totalMessagePrice === "number" ? { totalMessagePrice: object.totalMessagePrice } : {}),
  };
}

const FAILURE_EVENTS = [
  "TEXT_FAILED",
  "TEXT_BLOCKED",
  "TEXT_INVALID",
  "TEXT_INVALID_MESSAGE",
  "TEXT_UNREACHABLE",
  "TEXT_CARRIER_UNREACHABLE",
  "TEXT_CARRIER_BLOCKED",
  "TEXT_SPAM",
  "TEXT_TTL_EXPIRED",
  "TEXT_UNKNOWN",
  "TEXT_PROTECT_BLOCKED",
];

function statusFor(
  eventType: string,
): "SENT" | "DELIVERED" | "FAILED" | undefined {
  if (eventType === "TEXT_SUCCESSFUL") return "SENT";
  if (eventType === "TEXT_DELIVERED") return "DELIVERED";
  if (FAILURE_EVENTS.includes(eventType)) return "FAILED";
  return undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

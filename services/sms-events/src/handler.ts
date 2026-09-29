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
      await deps.ddb.send(
        new UpdateCommand({
          TableName: requiredEnv("DELIVERIES_TABLE"),
          Key: { deliveryId: parsed.deliveryId },
          UpdateExpression:
            "SET #status = :status, providerEventAt = :now, providerEventType = :eventType",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": status,
            ":now": deps.now().toISOString(),
            ":eventType": parsed.eventType,
          },
        }),
      );
      if (status === "DELIVERED" || status === "FAILED") {
        await deps.ddb.send(
          new UpdateCommand({
            TableName: requiredEnv("STATS_TABLE"),
            Key: { statsPk: "GLOBAL", statsSk: "TOTAL" },
            UpdateExpression: `ADD ${status === "DELIVERED" ? "delivered" : "failed"} :one SET updatedAt = :now`,
            ExpressionAttributeValues: {
              ":one": 1,
              ":now": deps.now().toISOString(),
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

function statusFor(
  eventType: string,
): "SENT" | "DELIVERED" | "FAILED" | undefined {
  if (eventType === "TEXT_SUCCESSFUL") return "SENT";
  if (eventType === "TEXT_DELIVERED") return "DELIVERED";
  if (["TEXT_FAILED", "TEXT_BLOCKED", "TEXT_INVALID"].includes(eventType))
    return "FAILED";
  return undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

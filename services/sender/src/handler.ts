// Lambda sender: SQS send-queue {deliveryId}. Plantilla GSM-7 (+ rewrite Bedrock opcional validado) -> SMS/Telegram/SIMULATED.
// SMS a Perú: SIN OriginationIdentity (ruta compartida), MessageType TRANSACTIONAL, MaxPrice, ConfigurationSetName, Context {deliveryId}.
// Ver prompts/03-matcher-and-sms.md y docs/RESEARCH.md §3.
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'sender' });

export const BEDROCK_MODEL_ID = 'us.amazon.nova-micro-v1:0';
export const SMS_PRICE_PE_USD = 0.23252; // prices.json oficial, 28-sep-2026

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of event.Records) {
    try {
      const { deliveryId } = JSON.parse(record.body) as { deliveryId: string };
      logger.info('send delivery', { deliveryId });
      // TODO(prompt 03): PENDING->SENDING condicional, flags SSM, render/rewrite+validate, canal, update Delivery+Stats
      throw new Error('TODO sender');
    } catch (err) {
      logger.error('send failed', { err, messageId: record.messageId });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

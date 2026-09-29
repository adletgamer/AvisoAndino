// Lambda matcher: SQS match-queue {warningId}. Decide con @aviso/core (determinista) y crea Deliveries idempotentes.
// Ver prompts/03-matcher-and-sms.md y docs/RULES.md.
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'matcher' });

export const openMeteoUrl = (lats: number[], lons: number[]) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
  `&daily=temperature_2m_min&timezone=America%2FLima&forecast_days=3`;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of event.Records) {
    try {
      const { warningId } = JSON.parse(record.body) as { warningId: string };
      logger.info('match dry run', { warningId });
      // El consumidor queda cableado para Prompt 03. Hasta que las reglas completas
      // estén probadas, no crea Deliveries ni encola envíos.
    } catch (err) {
      logger.error('match failed', { err, messageId: record.messageId });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

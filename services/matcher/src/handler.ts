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
      logger.info('match warning', { warningId });
      // TODO(prompt 03): cargar grupo del aviso + geometrías S3, suscriptores ACTIVE, decide(), PutItem condicional, SQS send-queue
      throw new Error('TODO matcher');
    } catch (err) {
      logger.error('match failed', { err, messageId: record.messageId });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

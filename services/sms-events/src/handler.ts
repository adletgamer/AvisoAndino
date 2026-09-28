// Lambda sms-events: SNS <- ConfigurationSet de End User Messaging (TEXT_DELIVERED, TEXT_FAILED, ...).
// Correlaciona por context.deliveryId. Loguear el primer evento real (sin teléfono) y documentar su formato en RESEARCH.md.
// Futuro: si hay short code PE, procesar respuestas entrantes "1" (confirmar) y "STOP"/"BAJA".
import type { SNSEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'sms-events' });

export async function handler(event: SNSEvent): Promise<void> {
  for (const r of event.Records) {
    logger.info('sms event', { messageId: r.Sns.MessageId });
    // TODO(prompt 03 parte D)
  }
}

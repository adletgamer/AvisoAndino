import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createSmsEventsHandler, parseSmsEvent, type SmsEventDependencies } from '../src/handler.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  process.env.DELIVERIES_TABLE = 'Deliveries';
  process.env.STATS_TABLE = 'Stats';
});

function event(message: string) {
  return {
    Records: [{
      EventSource: 'aws:sns',
      EventVersion: '1.0',
      EventSubscriptionArn: 'arn',
      Sns: {
        Type: 'Notification',
        MessageId: 'm1',
        TopicArn: 'arn',
        Subject: '',
        Message: message,
        Timestamp: '2026-09-29T00:00:00Z',
        SignatureVersion: '1',
        Signature: '',
        SigningCertUrl: '',
        UnsubscribeUrl: '',
        MessageAttributes: {},
      },
    }],
  };
}

function deps(): SmsEventDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    now: () => new Date('2026-09-29T00:00:00Z'),
    log: { info: vi.fn(), warn: vi.fn() } as unknown as SmsEventDependencies['log'],
  };
}

describe('eventos de End User Messaging', () => {
  it('extrae el deliveryId sin depender del teléfono', () => {
    expect(parseSmsEvent({ eventType: 'TEXT_DELIVERED', context: { deliveryId: 'D1' }, destinationPhoneNumber: '+51912345678' }))
      .toEqual({ eventType: 'TEXT_DELIVERED', deliveryId: 'D1' });
  });

  it('actualiza delivery y stats al recibir DELIVERED', async () => {
    const dependencies = deps();
    await createSmsEventsHandler(dependencies)(event(JSON.stringify({
      eventType: 'TEXT_DELIVERED',
      context: { deliveryId: 'D1' },
      destinationPhoneNumber: '+51912345678',
    })));
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
    expect(dependencies.log.info).toHaveBeenCalledWith('sms_event', {
      snsMessageId: 'm1',
      eventType: 'TEXT_DELIVERED',
      deliveryId: 'D1',
    });
    const calls = (dependencies.log.info as unknown as { mock: { calls: unknown[] } }).mock.calls;
    expect(JSON.stringify(calls)).not.toContain('+51912345678');
  });
});

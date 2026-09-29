import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import {
  clearSenderConfigCache,
  createSenderHandler,
  type SenderDependencies,
} from '../src/handler.js';

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
  process.env.DELIVERIES_TABLE = 'Deliveries';
  process.env.SUBSCRIBERS_TABLE = 'Subscribers';
  process.env.STATS_TABLE = 'Stats';
  process.env.SSM_PREFIX = '/aviso-andino/test';
  process.env.SMS_CONFIGURATION_SET = 'aviso-andino';
  ddbMock.on(UpdateCommand).resolves({});
});

function event(deliveryId = 'D1') {
  return {
    Records: [{
      messageId: 'm1',
      receiptHandle: 'r',
      body: JSON.stringify({ deliveryId }),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '0',
        SenderId: 'test',
        ApproximateFirstReceiveTimestamp: '0',
      },
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123:q',
      awsRegion: 'us-east-1',
    }],
  };
}

function deps(): SenderDependencies {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    sms: new PinpointSMSVoiceV2Client({}),
    ssm: new SSMClient({}),
    kms: new KMSClient({}),
    fetch: vi.fn(),
    now: () => new Date('2026-09-29T15:00:10Z'),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SenderDependencies['log'],
  };
}

function mockRecords(runId = 'LIVE') {
  ddbMock.on(GetCommand).callsFake((input) => {
    if (input.TableName === 'Deliveries') {
      return {
        Item: {
          deliveryId: 'D1',
          subscriberId: 'S1',
          runId,
          channel: 'SMS',
          text: 'SENAMHI NARANJA: aviso. Confirme: ejemplo.net/c/K7P2QX',
          status: 'PENDING',
          createdAt: '2026-09-29T15:00:00Z',
        },
      };
    }
    if (input.TableName === 'Subscribers') {
      return { Item: { subscriberId: 'S1', phoneHash: 'hash1', phoneEnc: `kms:${Buffer.from('cipher').toString('base64')}` } };
    }
    return { Item: { smsSent: 0 } };
  });
}

function mockConfig(enabled: boolean) {
  ssmMock.on(GetParametersCommand).resolves({
    Parameters: [
      { Name: '/aviso-andino/test/SMS_ENABLED', Value: String(enabled) },
      { Name: '/aviso-andino/test/SMS_DAILY_CAP', Value: '30' },
      { Name: '/aviso-andino/test/SMS_MAX_PRICE', Value: '0.30' },
      { Name: '/aviso-andino/test/sms/allowlist', Value: '["hash1"]' },
    ],
  });
}

describe('sender seguro e idempotente', () => {
  it('con SMS_ENABLED=false degrada a SIMULATED y nunca llama SMS', async () => {
    mockRecords();
    mockConfig(false);
    const response = await createSenderHandler(deps())(event());
    expect(response.batchItemFailures).toEqual([]);
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
    const transition = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(transition.ExpressionAttributeValues?.[':channel']).toBe('SIMULATED');
    expect(transition.ExpressionAttributeValues?.[':reason']).toBe('SMS_DISABLED');
  });

  it('un replay nunca envía SMS aunque el flag esté activo', async () => {
    mockRecords('REPLAY#R1');
    mockConfig(true);
    await createSenderHandler(deps())(event());
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
    const transition = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(transition.ExpressionAttributeValues?.[':reason']).toBe('REPLAY_FORCED_SIMULATED');
  });

  it('SMS habilitado usa SendTextMessage sin OriginationIdentity', async () => {
    mockRecords();
    mockConfig(true);
    kmsMock.on(DecryptCommand).resolves({ Plaintext: new TextEncoder().encode('+51912345678') });
    smsMock.on(SendTextMessageCommand).resolves({ MessageId: 'aws-message-1' });
    await createSenderHandler(deps())(event());
    const calls = smsMock.commandCalls(SendTextMessageCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toMatchObject({
      DestinationPhoneNumber: '+51912345678',
      MessageType: 'TRANSACTIONAL',
      ConfigurationSetName: 'aviso-andino',
      MaxPrice: '0.30',
      Context: { deliveryId: 'D1' },
    });
    expect(calls[0]?.args[0].input).not.toHaveProperty('OriginationIdentity');
  });

  it('si ya no está PENDING no procesa otra vez', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { deliveryId: 'D1', status: 'SENT' } });
    await createSenderHandler(deps())(event());
    expect(ssmMock.commandCalls(GetParametersCommand)).toHaveLength(0);
    expect(smsMock.commandCalls(SendTextMessageCommand)).toHaveLength(0);
  });
});

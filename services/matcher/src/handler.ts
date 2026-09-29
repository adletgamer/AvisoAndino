import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import {
  decide,
  LEVEL_COLOR,
  normalizeIndeci,
  normalizeWfs,
  render,
  segments,
  type NormalizedWarning,
  type Subscriber,
  type TemplateId,
} from '@aviso/core';
import { fetchMinimumTemperature } from './openMeteo.js';

const logger = new Logger({ serviceName: 'matcher' });

interface StoredWarning extends Omit<NormalizedWarning, 'areas'> {
  s3Key: string;
  listLevelColor?: 'AMARILLO' | 'NARANJA' | 'ROJO';
  replayRunId?: string;
}

export interface MatcherDependencies {
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  sqs: SQSClient;
  now: () => Date;
  confirmCode: () => string;
  getTmin: (lat: number, lon: number) => Promise<number | undefined>;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
}

const defaultDependencies: MatcherDependencies = {
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  s3: new S3Client({}),
  sqs: new SQSClient({}),
  now: () => new Date(),
  confirmCode: createConfirmCode,
  getTmin: fetchMinimumTemperature,
  log: logger,
};

export function createMatcherHandler(deps: MatcherDependencies = defaultDependencies) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records) {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const warningId = (parsed as { warningId?: unknown }).warningId;
        if (typeof warningId !== 'string' || !warningId) throw new Error('Mensaje sin warningId');
        await matchWarning(warningId, deps);
      } catch (error) {
        deps.log.error('match_failed', { error: errorMessage(error), messageId: record.messageId });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

export const handler = createMatcherHandler();

async function matchWarning(warningId: string, deps: MatcherDependencies): Promise<void> {
  const warningsTable = requiredEnv('WARNINGS_TABLE');
  const warningResult = await deps.ddb.send(new GetCommand({ TableName: warningsTable, Key: { warningId } }));
  if (!warningResult.Item) throw new Error(`Warning no encontrado: ${warningId}`);
  const trigger = warningResult.Item as StoredWarning;
  const groupResult = await deps.ddb.send(new QueryCommand({
    TableName: warningsTable,
    IndexName: 'byAviso',
    KeyConditionExpression: 'avisoKey = :avisoKey',
    ExpressionAttributeValues: { ':avisoKey': trigger.avisoKey },
  }));
  const storedGroup = (groupResult.Items ?? []) as StoredWarning[];
  const warningGroup = await Promise.all(storedGroup.map((warning) => hydrateWarning(warning, deps)));
  const subscriberResult = await deps.ddb.send(new QueryCommand({
    TableName: requiredEnv('SUBSCRIBERS_TABLE'),
    IndexName: 'byStatus',
    KeyConditionExpression: '#status = :active',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':active': 'ACTIVE' },
  }));
  const subscribers = (subscriberResult.Items ?? []) as Subscriber[];
  const replay = trigger.source === 'REPLAY';
  const eligible = replay ? subscribers.filter((subscriber) => subscriber.isDemo) : subscribers;
  for (const subscriber of eligible) await matchSubscriber(subscriber, warningGroup, trigger, deps);
  deps.log.info('warning_evaluado', { warningId, subscriberCount: eligible.length });
}

async function matchSubscriber(
  subscriber: Subscriber,
  warningGroup: NormalizedWarning[],
  trigger: StoredWarning,
  deps: MatcherDependencies,
): Promise<void> {
  const now = deps.now();
  const runId = trigger.source === 'REPLAY' ? `REPLAY#${trigger.replayRunId ?? 'UNKNOWN'}` : 'LIVE';
  const keyPrefix = deliveryPrefix(subscriber.subscriberId, trigger, runId);
  const sent = await deps.ddb.send(new BatchGetCommand({
    RequestItems: {
      [requiredEnv('DELIVERIES_TABLE')]: {
        Keys: [2, 3, 4].map((level) => ({ deliveryId: `${keyPrefix}#L${level}` })),
      },
    },
  }));
  const alreadySentLevels = (sent.Responses?.[requiredEnv('DELIVERIES_TABLE')] ?? [])
    .map((item) => item.level)
    .filter((value): value is number => typeof value === 'number');
  const dayStart = limaDayStart(now);
  const todayResult = await deps.ddb.send(new QueryCommand({
    TableName: requiredEnv('DELIVERIES_TABLE'),
    IndexName: 'bySubscriber',
    KeyConditionExpression: 'subscriberId = :subscriberId AND createdAt >= :start',
    ExpressionAttributeValues: { ':subscriberId': subscriber.subscriberId, ':start': dayStart },
  }));
  const sentToday = (todayResult.Items ?? []).filter((item) => item.channel === 'SMS').length;
  const stats = await deps.ddb.send(new GetCommand({
    TableName: requiredEnv('STATS_TABLE'),
    Key: { statsPk: 'GLOBAL', statsSk: `DAY#${dayStart.slice(0, 10)}` },
  }));
  const globalSmsToday = typeof stats.Item?.smsSent === 'number' ? stats.Item.smsSent : 0;
  const decision = decide({
    subscriber,
    warningGroup,
    alreadySentLevels,
    sentTodayToSubscriber: sentToday,
    globalSentToday: globalSmsToday,
    now,
  });
  if (!decision.send || !decision.template || !decision.fechas) {
    await recordSkip(decision.reason ?? 'outside_polygons', runId, now, deps);
    return;
  }

  const level = decision.level;
  const deliveryId = `${keyPrefix}#L${level}`;
  const confirmCode = await uniqueConfirmCode(deps);
  let template: TemplateId = decision.template;
  let tmin: number | undefined;
  if (warningGroup[0]?.hazard === 'HELADA') {
    tmin = await deps.getTmin(subscriber.lat, subscriber.lon);
    template = tmin === undefined ? 'HELADA_SIN_TMIN' : 'HELADA';
  }
  const channel = trigger.source === 'REPLAY' ? 'SIMULATED' : decision.channelOverride ?? subscriber.channel;
  const place = subscriber.centroPoblado ?? subscriber.distrito ?? subscriber.departamento ?? 'SU COLEGIO';
  const link = `${requiredEnv('PUBLIC_BASE_URL').replace(/^https?:\/\//, '').replace(/\/$/, '')}/c/${confirmCode}`;
  const text = render(template, {
    COLOR: LEVEL_COLOR[level as 2 | 3 | 4],
    fechas: decision.fechas,
    lugar: place,
    tmin,
    nro: trigger.nroAviso,
    link,
  });
  const createdAt = now.toISOString();
  const scheduleAt = decision.scheduleAt;
  const status = scheduleAt ? 'SCHEDULED' : 'PENDING';
  const smsInfo = segments(text);
  const item = {
    deliveryId,
    subscriberId: subscriber.subscriberId,
    avisoKey: trigger.avisoKey,
    warningIds: decision.warningIds,
    runId,
    level,
    hazard: warningGroup[0]!.hazard,
    template,
    channel,
    text,
    segments: smsInfo.count,
    encoding: smsInfo.encoding,
    status,
    statusHistory: [{ s: status, t: createdAt }],
    confirmCode,
    createdAt,
    capped: decision.capped ?? false,
    ttl: Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60,
    ...(scheduleAt ? { scheduleAt } : {}),
  };
  try {
    await deps.ddb.send(new PutCommand({
      TableName: requiredEnv('DELIVERIES_TABLE'),
      Item: item,
      ConditionExpression: 'attribute_not_exists(deliveryId)',
    }));
  } catch (error) {
    if (isConditionalFailure(error)) {
      deps.log.info('delivery_duplicada', { deliveryId, subscriberId: subscriber.subscriberId });
      return;
    }
    throw error;
  }

  if (!scheduleAt || Date.parse(scheduleAt) - now.getTime() <= 900_000) {
    await deps.sqs.send(new SendMessageCommand({
      QueueUrl: requiredEnv('SEND_QUEUE_URL'),
      MessageBody: JSON.stringify({ deliveryId }),
      DelaySeconds: scheduleAt ? Math.max(0, Math.ceil((Date.parse(scheduleAt) - now.getTime()) / 1000)) : 0,
    }));
  }
  deps.log.info('delivery_creada', { deliveryId, subscriberId: subscriber.subscriberId, channel });
}

async function hydrateWarning(stored: StoredWarning, deps: MatcherDependencies): Promise<NormalizedWarning> {
  const object = await deps.s3.send(new GetObjectCommand({
    Bucket: requiredEnv('SNAPSHOTS_BUCKET'),
    Key: stored.s3Key,
  }));
  if (!object.Body) throw new Error(`Snapshot vacío: ${stored.s3Key}`);
  const compressed = await object.Body.transformToByteArray();
  const collection = JSON.parse(gunzipSync(compressed).toString('utf8')) as FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
  if (stored.source === 'INDECI_PP24H') {
    return { ...normalizeIndeci(collection as Parameters<typeof normalizeIndeci>[0], () => stored.contentHash.replace(/^sha256:/, '')), ...stored };
  }
  const normalized = normalizeWfs(collection as Parameters<typeof normalizeWfs>[0], {
    nro: stored.nroAviso,
    year: stored.year,
    title: stored.title,
    color: stored.listLevelColor ?? 'NARANJA',
    emision: stored.fechaEmi,
    inicio: stored.fechIni.slice(0, 10),
    fin: stored.fechFin.slice(0, 10),
  }, () => stored.contentHash.replace(/^sha256:/, ''));
  return { ...normalized, ...stored, areas: normalized.areas };
}

async function uniqueConfirmCode(deps: MatcherDependencies): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = deps.confirmCode();
    const result = await deps.ddb.send(new QueryCommand({
      TableName: requiredEnv('DELIVERIES_TABLE'),
      IndexName: 'byConfirmCode',
      KeyConditionExpression: 'confirmCode = :code',
      ExpressionAttributeValues: { ':code': code },
      Limit: 1,
    }));
    if (!result.Items?.length) return code;
  }
  throw new Error('No se pudo generar confirmCode único');
}

async function recordSkip(reason: string, runId: string, now: Date, deps: MatcherDependencies): Promise<void> {
  await deps.ddb.send(new UpdateCommand({
    TableName: requiredEnv('STATS_TABLE'),
    Key: { statsPk: runId === 'LIVE' ? 'GLOBAL' : `RUN#${runId.replace(/^REPLAY#/, '')}`, statsSk: 'TOTAL' },
    UpdateExpression: 'ADD skipped :one SET updatedAt = :now, lastSkipReason = :reason',
    ExpressionAttributeValues: { ':one': 1, ':now': now.toISOString(), ':reason': reason },
  }));
}

function createConfirmCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function deliveryPrefix(subscriberId: string, warning: StoredWarning, runId: string): string {
  return runId === 'LIVE'
    ? `${subscriberId}#${warning.year}#${warning.nroAviso}`
    : `${subscriberId}#${runId}#${warning.year}#${warning.nroAviso}`;
}

function limaDayStart(now: Date): string {
  const local = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 5)).toISOString();
}

function isConditionalFailure(error: unknown): boolean {
  return (error as { name?: string }).name === 'ConditionalCheckFailedException';
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

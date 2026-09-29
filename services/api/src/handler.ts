// Lambda api (HTTP API payload v2). Router mínimo sin Express. Contratos en docs/API.md.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const logger = new Logger({ serviceName: 'api' });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const warningsTable = process.env.WARNINGS_TABLE ?? '';
const statsTable = process.env.STATS_TABLE ?? '';

type Route = (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
const todo: Route = async () => json(501, { error: { code: 'NOT_IMPLEMENTED', message: 'Pendiente' } });

export interface ApiDependencies {
  ddb: DynamoDBDocumentClient;
  ssm: SSMClient;
  now: () => Date;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
}

const defaultDependencies: ApiDependencies = {
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ssm: new SSMClient({}),
  now: () => new Date(),
  log: logger,
};

export function createApiHandler(deps: ApiDependencies = defaultDependencies) {
  const routes: Record<string, Route> = {
    'GET /api/status': status,
    'GET /api/alerts': alerts,
    'GET /api/metrics': metrics,
    'POST /api/subscribers': todo,
    'DELETE /api/subscribers/{subscriberId}': todo,
    'GET /api/confirm/{code}': (event) => getConfirmation(event, deps),
    'POST /api/confirm': (event) => postConfirmation(event, deps),
    'GET /api/alerts/{warningId}/geometry': todo,
    'POST /api/replay': todo,
    'GET /api/replay/{runId}/deliveries': todo,
    'POST /api/telegram/webhook': (event) => telegramWebhook(event, deps),
    'POST /subscribers': todo,
    'DELETE /subscribers/{subscriberId}': todo,
    'GET /confirm/{code}': (event) => getConfirmation(event, deps),
    'POST /confirm': (event) => postConfirmation(event, deps),
    'GET /alerts': todo,
    'GET /alerts/{warningId}/geometry': todo,
    'GET /metrics': todo,
    'POST /replay': todo,
    'GET /replay/{runId}/deliveries': todo,
    'POST /telegram/webhook': (event) => telegramWebhook(event, deps),
  };
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const route = routes[event.routeKey];
    deps.log.info('api_request', { routeKey: event.routeKey });
    if (!route) return json(404, { error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
    return route(event);
  };
}

export const handler = createApiHandler();

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  };
}

async function status(): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    service: 'Aviso Andino',
    stage: process.env.STAGE ?? 'unknown',
    status: 'MVP_READY',
    ingestEnabled: process.env.INGEST_ENABLED === 'true',
    smsEnabled: process.env.SMS_ENABLED === 'true',
    rewriteEnabled: process.env.REWRITE_ENABLED === 'true',
    generatedAt: new Date().toISOString(),
  });
}

async function alerts(): Promise<APIGatewayProxyResultV2> {
  if (!warningsTable) return configurationError();
  const result = await ddb.send(new QueryCommand({
    TableName: warningsTable,
    IndexName: 'byActive',
    KeyConditionExpression: 'activeFlag = :active',
    ExpressionAttributeValues: { ':active': '1' },
    ScanIndexForward: false,
    Limit: 50,
    ProjectionExpression: [
      'warningId',
      'avisoKey',
      'source',
      '#year',
      'nroAviso',
      'mapa',
      'hazard',
      'title',
      'maxLevel',
      'fechIni',
      'fechFin',
      'firstSeenAt',
    ].join(', '),
    ExpressionAttributeNames: { '#year': 'year' },
  }));
  return json(200, { items: result.Items ?? [], nextToken: null });
}

async function metrics(): Promise<APIGatewayProxyResultV2> {
  if (!statsTable) return configurationError();
  const result = await ddb.send(new GetCommand({
    TableName: statsTable,
    Key: { statsPk: 'GLOBAL', statsSk: 'TOTAL' },
  }));
  const item = result.Item ?? {};
  const sent = numberOf(item.sent);
  const confirmed = numberOf(item.confirmed);
  return json(200, {
    runId: 'LIVE',
    generatedAt: new Date().toISOString(),
    totals: {
      warningsIngested: numberOf(item.warningsIngested),
      alertsSent: sent,
      delivered: numberOf(item.delivered),
      failed: numberOf(item.failed),
      confirmed,
      confirmedPct: sent === 0 ? 0 : Math.round((confirmed / sent) * 1000) / 10,
      skipped: numberOf(item.skipped),
      capped: numberOf(item.capped),
    },
  });
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function configurationError(): APIGatewayProxyResultV2 {
  return json(503, {
    error: {
      code: 'CONFIGURATION_ERROR',
      message: 'El servicio todavia no tiene sus tablas configuradas.',
    },
  });
}

async function getConfirmation(event: APIGatewayProxyEventV2, deps: ApiDependencies): Promise<APIGatewayProxyResultV2> {
  const code = event.pathParameters?.code;
  if (!isConfirmCode(code)) return validationError('Código de confirmación inválido');
  const delivery = await deliveryByCode(code, deps);
  if (!delivery) return json(404, { error: { code: 'NOT_FOUND', message: 'Aviso no encontrado o vencido' } });
  return json(200, {
    code,
    alreadyConfirmed: Boolean(delivery.confirmedAt),
    alert: {
      title: delivery.title ?? 'Aviso oficial SENAMHI',
      color: delivery.color,
      level: delivery.level,
      fechas: delivery.fechas,
      lugar: delivery.lugar,
      tmin: delivery.tmin,
      hazard: delivery.hazard,
      recommendations: delivery.recommendations ?? [],
      officialUrl: delivery.officialUrl ?? 'https://www.senamhi.gob.pe/?p=aviso-meteorologico',
    },
  });
}

async function postConfirmation(event: APIGatewayProxyEventV2, deps: ApiDependencies): Promise<APIGatewayProxyResultV2> {
  const body = parseJson(event.body);
  const code = (body as { code?: unknown } | undefined)?.code;
  const channel = (body as { channel?: unknown } | undefined)?.channel ?? 'LINK';
  if (!isConfirmCode(code) || (channel !== 'LINK' && channel !== 'SIMULATED')) {
    return validationError('Datos de confirmación inválidos');
  }
  const result = await confirmByCode(code, channel, deps);
  if (!result) return json(404, { error: { code: 'NOT_FOUND', message: 'Aviso no encontrado o vencido' } });
  return json(200, result);
}

async function telegramWebhook(event: APIGatewayProxyEventV2, deps: ApiDependencies): Promise<APIGatewayProxyResultV2> {
  const supplied = event.headers['x-telegram-bot-api-secret-token'];
  const secret = await telegramSecret(deps);
  if (!supplied || supplied !== secret) {
    deps.log.warn('telegram_secret_invalido');
    return json(401, { error: { code: 'UNAUTHORIZED', message: 'Token inválido' } });
  }
  const update = parseJson(event.body) as TelegramUpdate | undefined;
  if (!update) return json(200, { ok: true });
  const callbackCode = update.callback_query?.data?.match(/^ack:([0-9A-HJKMNP-TV-Z]{6})$/)?.[1];
  if (callbackCode) {
    await confirmByCode(callbackCode, 'TELEGRAM', deps);
    return json(200, { ok: true });
  }
  if (!isAcknowledgement(update.message?.text)) return json(200, { ok: true });
  const chatId = update.message?.chat.id;
  if (chatId === undefined) return json(200, { ok: true });
  const subscriberResult = await deps.ddb.send(new QueryCommand({
    TableName: requiredEnv('SUBSCRIBERS_TABLE'),
    IndexName: 'byTelegramChat',
    KeyConditionExpression: 'telegramChatId = :chatId',
    ExpressionAttributeValues: { ':chatId': String(chatId) },
    Limit: 1,
  }));
  const subscriberId = subscriberResult.Items?.[0]?.subscriberId;
  if (typeof subscriberId !== 'string') return json(200, { ok: true });
  const recent = await deps.ddb.send(new QueryCommand({
    TableName: requiredEnv('DELIVERIES_TABLE'),
    IndexName: 'bySubscriber',
    KeyConditionExpression: 'subscriberId = :subscriberId AND createdAt >= :cutoff',
    ExpressionAttributeValues: {
      ':subscriberId': subscriberId,
      ':cutoff': new Date(deps.now().getTime() - 72 * 60 * 60 * 1000).toISOString(),
    },
    ScanIndexForward: false,
    Limit: 5,
  }));
  const pending = recent.Items?.find((item) => !item.confirmedAt && typeof item.confirmCode === 'string');
  if (pending?.confirmCode) await confirmByCode(pending.confirmCode, 'TELEGRAM', deps);
  return json(200, { ok: true });
}

interface TelegramUpdate {
  message?: { text?: string; chat: { id: string | number } };
  callback_query?: { data?: string };
}

async function confirmByCode(
  code: string,
  channel: 'LINK' | 'SIMULATED' | 'TELEGRAM',
  deps: ApiDependencies,
): Promise<{ confirmed: true; confirmedAt: string; firstTime: boolean } | undefined> {
  const delivery = await deliveryByCode(code, deps);
  if (!delivery || typeof delivery.deliveryId !== 'string') return undefined;
  if (typeof delivery.confirmedAt === 'string') {
    return { confirmed: true, confirmedAt: delivery.confirmedAt, firstTime: false };
  }
  const confirmedAt = deps.now().toISOString();
  try {
    await deps.ddb.send(new UpdateCommand({
      TableName: requiredEnv('DELIVERIES_TABLE'),
      Key: { deliveryId: delivery.deliveryId },
      UpdateExpression: 'SET confirmedAt = :now, confirmChannel = :channel',
      ConditionExpression: 'attribute_not_exists(confirmedAt)',
      ExpressionAttributeValues: { ':now': confirmedAt, ':channel': channel },
    }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    const current = await deliveryByCode(code, deps);
    return {
      confirmed: true,
      confirmedAt: typeof current?.confirmedAt === 'string' ? current.confirmedAt : confirmedAt,
      firstTime: false,
    };
  }
  await deps.ddb.send(new UpdateCommand({
    TableName: requiredEnv('STATS_TABLE'),
    Key: { statsPk: delivery.runId === 'LIVE' ? 'GLOBAL' : `RUN#${String(delivery.runId).replace(/^REPLAY#/, '')}`, statsSk: 'TOTAL' },
    UpdateExpression: 'ADD confirmed :one SET updatedAt = :now',
    ExpressionAttributeValues: { ':one': 1, ':now': confirmedAt },
  }));
  return { confirmed: true, confirmedAt, firstTime: true };
}

async function deliveryByCode(code: string, deps: ApiDependencies): Promise<Record<string, unknown> | undefined> {
  const result = await deps.ddb.send(new QueryCommand({
    TableName: requiredEnv('DELIVERIES_TABLE'),
    IndexName: 'byConfirmCode',
    KeyConditionExpression: 'confirmCode = :code',
    ExpressionAttributeValues: { ':code': code },
    Limit: 1,
  }));
  return result.Items?.[0];
}

async function telegramSecret(deps: ApiDependencies): Promise<string> {
  const response = await deps.ssm.send(new GetParameterCommand({
    Name: `${requiredEnv('SSM_PREFIX').replace(/\/$/, '')}/telegram/webhookSecret`,
    WithDecryption: true,
  }));
  return response.Parameter?.Value ?? '';
}

function isAcknowledgement(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return normalized === '1' || normalized === 'si';
}

function isConfirmCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{6}$/.test(value);
}

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function validationError(message: string): APIGatewayProxyResultV2 {
  return json(400, { error: { code: 'VALIDATION_ERROR', message } });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

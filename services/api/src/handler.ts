// Lambda api (HTTP API payload v2). Router mínimo sin Express. Contratos en docs/API.md.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const logger = new Logger({ serviceName: 'api' });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const warningsTable = process.env.WARNINGS_TABLE ?? '';
const statsTable = process.env.STATS_TABLE ?? '';

type Route = (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
const todo: Route = async () => json(501, { error: { code: 'NOT_IMPLEMENTED', message: 'Pendiente' } });

const routes: Record<string, Route> = {
  'GET /api/status': status,
  'GET /api/alerts': alerts,
  'GET /api/metrics': metrics,
  'POST /api/subscribers': todo, // prompt 04
  'DELETE /api/subscribers/{subscriberId}': todo,
  'GET /api/confirm/{code}': todo, // NO confirma
  'POST /api/confirm': todo,
  'GET /api/alerts/{warningId}/geometry': todo, // prompt 05
  'POST /api/replay': todo,
  'GET /api/replay/{runId}/deliveries': todo,
  'POST /api/telegram/webhook': todo, // valida X-Telegram-Bot-Api-Secret-Token
};

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const route = routes[event.routeKey];
  logger.info('request', { routeKey: event.routeKey });
  if (!route) return json(404, { error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
  return route(event);
}

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

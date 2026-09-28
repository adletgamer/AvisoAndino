// Lambda api (HTTP API payload v2). Router mínimo sin Express. Contratos en docs/API.md.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'api' });

type Route = (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
const todo: Route = async () => json(501, { error: { code: 'NOT_IMPLEMENTED', message: 'Pendiente' } });

const routes: Record<string, Route> = {
  'POST /subscribers': todo, // prompt 04
  'DELETE /subscribers/{subscriberId}': todo,
  'GET /confirm/{code}': todo, // NO confirma
  'POST /confirm': todo,
  'GET /alerts': todo, // prompt 05
  'GET /alerts/{warningId}/geometry': todo,
  'GET /metrics': todo,
  'POST /replay': todo,
  'GET /replay/{runId}/deliveries': todo,
  'POST /telegram/webhook': todo, // valida X-Telegram-Bot-Api-Secret-Token
};

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const route = routes[event.routeKey];
  logger.info('request', { routeKey: event.routeKey });
  if (!route) return json(404, { error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
  return route(event);
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

// Lambda api (HTTP API payload v2). Router mínimo sin Express. Contratos en docs/API.md.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
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
import { GetParameterCommand, GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { maskPhone, replayRequestSchema, subscriberRequestSchema } from '@aviso/core';
import { encryptPhone, hashPhone } from '@aviso/core/src/phoneCrypto.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const logger = new Logger({ serviceName: 'api' });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const warningsTable = process.env.WARNINGS_TABLE ?? '';
const statsTable = process.env.STATS_TABLE ?? '';

type Route = (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
const todo: Route = async () =>
  json(501, { error: { code: "NOT_IMPLEMENTED", message: "Pendiente" } });

export interface ApiDependencies {
  ddb: DynamoDBDocumentClient;
  ssm: SSMClient;
  lambda?: LambdaClient;
  now: () => Date;
  log: Pick<Logger, "info" | "warn" | "error">;
}

const defaultDependencies: ApiDependencies = {
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ssm: new SSMClient({}),
  lambda: new LambdaClient({}),
  now: () => new Date(),
  log: logger,
};

export function createApiHandler(deps: ApiDependencies = defaultDependencies) {
  const routes: Record<string, Route> = {
    'GET /api/status': () => status(deps),
    'GET /api/alerts': alerts,
    'GET /api/metrics': (event) => metrics(event, deps),
    'GET /api/panel': () => panel(deps),
    'POST /api/subscribers': (event) => createSubscriber(event, deps),
    'DELETE /api/subscribers/{subscriberId}': todo,
    'GET /api/confirm/{code}': (event) => getConfirmation(event, deps),
    'POST /api/confirm': (event) => postConfirmation(event, deps),
    'GET /api/alerts/{warningId}/geometry': todo,
    'POST /api/replay': (event) => startReplay(event, deps),
    'GET /api/replay/{runId}/deliveries': (event) => replayDeliveries(event, deps),
    'POST /api/telegram/webhook': (event) => telegramWebhook(event, deps),
    'POST /subscribers': (event) => createSubscriber(event, deps),
    'DELETE /subscribers/{subscriberId}': todo,
    'GET /confirm/{code}': (event) => getConfirmation(event, deps),
    'POST /confirm': (event) => postConfirmation(event, deps),
    'GET /alerts': todo,
    'GET /alerts/{warningId}/geometry': todo,
    'GET /metrics': todo,
    'POST /replay': (event) => startReplay(event, deps),
    'GET /replay/{runId}/deliveries': (event) => replayDeliveries(event, deps),
    'POST /telegram/webhook': (event) => telegramWebhook(event, deps),
  };
  return async (
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyResultV2> => {
    const route = routes[event.routeKey];
    deps.log.info("api_request", { routeKey: event.routeKey });
    if (!route)
      return json(404, {
        error: { code: "NOT_FOUND", message: "Ruta no encontrada" },
      });
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

async function status(deps: ApiDependencies): Promise<APIGatewayProxyResultV2> {
  // Interruptores reales: los de SSM (el sender los lee de ahí), no las variables de entorno.
  const params = await ssmValues(['SMS_ENABLED', 'REWRITE_ENABLED'], deps).catch(() => new Map<string, string>());
  return json(200, {
    service: 'Aviso Andino',
    stage: process.env.STAGE ?? 'unknown',
    status: 'MVP_READY',
    ingestEnabled: process.env.INGEST_ENABLED === 'true',
    smsEnabled: params.get('SMS_ENABLED') === 'true',
    rewriteEnabled: params.get('REWRITE_ENABLED') === 'true',
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

async function metrics(event: APIGatewayProxyEventV2, deps: ApiDependencies): Promise<APIGatewayProxyResultV2> {
  if (!statsTable) return configurationError();
  const requested = (event.queryStringParameters?.runId ?? 'LIVE').replace(/^REPLAY#/, '');
  if (requested !== 'LIVE' && !isRunId(requested)) return validationError('runId inválido');
  const result = await deps.ddb.send(new GetCommand({
    TableName: statsTable,
    Key: { statsPk: requested === 'LIVE' ? 'GLOBAL' : `RUN#${requested}`, statsSk: 'TOTAL' },
  }));
  const item = result.Item ?? {};
  const sent = numberOf(item.sent);
  const confirmed = numberOf(item.confirmed);
  return json(200, {
    runId: requested === 'LIVE' ? 'LIVE' : `REPLAY#${requested}`,
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

async function getConfirmation(
  event: APIGatewayProxyEventV2,
  deps: ApiDependencies,
): Promise<APIGatewayProxyResultV2> {
  const code = event.pathParameters?.code;
  if (!isConfirmCode(code))
    return validationError("Código de confirmación inválido");
  const delivery = await deliveryByCode(code, deps);
  if (!delivery)
    return json(404, {
      error: { code: "NOT_FOUND", message: "Aviso no encontrado o vencido" },
    });
  return json(200, {
    code,
    alreadyConfirmed: Boolean(delivery.confirmedAt),
    alert: {
      title: delivery.title ?? "Aviso oficial SENAMHI",
      color: delivery.color,
      level: delivery.level,
      fechas: delivery.fechas,
      lugar: delivery.lugar,
      tmin: delivery.tmin,
      hazard: delivery.hazard,
      recommendations: delivery.recommendations ?? [],
      officialUrl:
        delivery.officialUrl ??
        "https://www.senamhi.gob.pe/?p=aviso-meteorologico",
    },
  });
}

async function postConfirmation(
  event: APIGatewayProxyEventV2,
  deps: ApiDependencies,
): Promise<APIGatewayProxyResultV2> {
  const body = parseJson(event.body);
  const code = (body as { code?: unknown } | undefined)?.code;
  const channel =
    (body as { channel?: unknown } | undefined)?.channel ?? "LINK";
  if (!isConfirmCode(code) || (channel !== "LINK" && channel !== "SIMULATED")) {
    return validationError("Datos de confirmación inválidos");
  }
  const result = await confirmByCode(code, channel, deps);
  if (!result)
    return json(404, {
      error: { code: "NOT_FOUND", message: "Aviso no encontrado o vencido" },
    });
  return json(200, result);
}

async function telegramWebhook(
  event: APIGatewayProxyEventV2,
  deps: ApiDependencies,
): Promise<APIGatewayProxyResultV2> {
  const supplied = event.headers["x-telegram-bot-api-secret-token"];
  const secret = await telegramSecret(deps);
  if (!supplied || supplied !== secret) {
    deps.log.warn("telegram_secret_invalido");
    return json(401, {
      error: { code: "UNAUTHORIZED", message: "Token inválido" },
    });
  }
  const update = parseJson(event.body) as TelegramUpdate | undefined;
  if (!update) return json(200, { ok: true });
  const callbackCode = update.callback_query?.data?.match(
    /^ack:([0-9A-HJKMNP-TV-Z]{6})$/,
  )?.[1];
  if (callbackCode) {
    await confirmByCode(callbackCode, "TELEGRAM", deps);
    return json(200, { ok: true });
  }
  if (!isAcknowledgement(update.message?.text)) return json(200, { ok: true });
  const chatId = update.message?.chat.id;
  if (chatId === undefined) return json(200, { ok: true });
  const subscriberResult = await deps.ddb.send(
    new QueryCommand({
      TableName: requiredEnv("SUBSCRIBERS_TABLE"),
      IndexName: "byTelegramChat",
      KeyConditionExpression: "telegramChatId = :chatId",
      ExpressionAttributeValues: { ":chatId": String(chatId) },
      Limit: 1,
    }),
  );
  const subscriberId = subscriberResult.Items?.[0]?.subscriberId;
  if (typeof subscriberId !== "string") return json(200, { ok: true });
  const recent = await deps.ddb.send(
    new QueryCommand({
      TableName: requiredEnv("DELIVERIES_TABLE"),
      IndexName: "bySubscriber",
      KeyConditionExpression:
        "subscriberId = :subscriberId AND createdAt >= :cutoff",
      ExpressionAttributeValues: {
        ":subscriberId": subscriberId,
        ":cutoff": new Date(
          deps.now().getTime() - 72 * 60 * 60 * 1000,
        ).toISOString(),
      },
      ScanIndexForward: false,
      Limit: 5,
    }),
  );
  const pending = recent.Items?.find(
    (item) => !item.confirmedAt && typeof item.confirmCode === "string",
  );
  if (pending?.confirmCode)
    await confirmByCode(pending.confirmCode, "TELEGRAM", deps);
  return json(200, { ok: true });
}

interface TelegramUpdate {
  message?: { text?: string; chat: { id: string | number } };
  callback_query?: { data?: string };
}

async function confirmByCode(
  code: string,
  channel: "LINK" | "SIMULATED" | "TELEGRAM",
  deps: ApiDependencies,
): Promise<
  { confirmed: true; confirmedAt: string; firstTime: boolean } | undefined
> {
  const delivery = await deliveryByCode(code, deps);
  if (!delivery || typeof delivery.deliveryId !== "string") return undefined;
  if (typeof delivery.confirmedAt === "string") {
    return {
      confirmed: true,
      confirmedAt: delivery.confirmedAt,
      firstTime: false,
    };
  }
  const confirmedAt = deps.now().toISOString();
  try {
    await deps.ddb.send(
      new UpdateCommand({
        TableName: requiredEnv("DELIVERIES_TABLE"),
        Key: { deliveryId: delivery.deliveryId },
        UpdateExpression: "SET confirmedAt = :now, confirmChannel = :channel",
        ConditionExpression: "attribute_not_exists(confirmedAt)",
        ExpressionAttributeValues: { ":now": confirmedAt, ":channel": channel },
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException")
      throw error;
    const current = await deliveryByCode(code, deps);
    return {
      confirmed: true,
      confirmedAt:
        typeof current?.confirmedAt === "string"
          ? current.confirmedAt
          : confirmedAt,
      firstTime: false,
    };
  }
  await deps.ddb.send(
    new UpdateCommand({
      TableName: requiredEnv("STATS_TABLE"),
      Key: {
        statsPk:
          delivery.runId === "LIVE"
            ? "GLOBAL"
            : `RUN#${String(delivery.runId).replace(/^REPLAY#/, "")}`,
        statsSk: "TOTAL",
      },
      UpdateExpression: "ADD confirmed :one SET updatedAt = :now",
      ExpressionAttributeValues: { ":one": 1, ":now": confirmedAt },
    }),
  );
  return { confirmed: true, confirmedAt, firstTime: true };
}

async function deliveryByCode(
  code: string,
  deps: ApiDependencies,
): Promise<Record<string, unknown> | undefined> {
  const result = await deps.ddb.send(
    new QueryCommand({
      TableName: requiredEnv("DELIVERIES_TABLE"),
      IndexName: "byConfirmCode",
      KeyConditionExpression: "confirmCode = :code",
      ExpressionAttributeValues: { ":code": code },
      Limit: 1,
    }),
  );
  return result.Items?.[0];
}

async function telegramSecret(deps: ApiDependencies): Promise<string> {
  const response = await deps.ssm.send(
    new GetParameterCommand({
      Name: `${requiredEnv("SSM_PREFIX").replace(/\/$/, "")}/telegram/webhookSecret`,
      WithDecryption: true,
    }),
  );
  return response.Parameter?.Value ?? "";
}

function isAcknowledgement(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized === "1" || normalized === "si";
}

function isConfirmCode(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{6}$/.test(value);
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
  return json(400, { error: { code: "VALIDATION_ERROR", message } });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// Registro (POST /subscribers) — docs/API.md
// ---------------------------------------------------------------------------

const CONSENT_VERSION = 'v1';
const RETENTION_DAYS = 180;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

async function createSubscriber(
  event: APIGatewayProxyEventV2,
  deps: ApiDependencies,
): Promise<APIGatewayProxyResultV2> {
  const parsed = subscriberRequestSchema.safeParse(parseJson(event.body));
  if (!parsed.success) {
    return json(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los datos del formulario.',
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
  }
  const input = parsed.data;
  const now = deps.now();
  const createdAt = now.toISOString();
  const subscriberId = ulid(now);
  const activationCode = confirmCodeValue();
  const location = input.location;
  const base = {
    subscriberId,
    channel: input.channel,
    role: input.role,
    lat: location.lat,
    lon: location.lon,
    ...(location.codMod ? { codMod: location.codMod } : {}),
    ...(location.centroPoblado ? { centroPoblado: location.centroPoblado.trim() } : {}),
    ...(location.distrito ? { distrito: location.distrito.trim() } : {}),
    ...(location.departamento ? { departamento: location.departamento.trim() } : {}),
    minLevel: input.minLevel,
    hazards: input.hazards,
    consentAt: createdAt,
    consentVersion: CONSENT_VERSION,
    activationCode,
    createdAt,
    ttl: Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 24 * 60 * 60,
  };

  if (input.channel === 'SIMULATED') {
    // "Solo simulación": nunca recibe SMS (isDemo + canal SIMULATED; el sender fuerza SIMULATED en replays).
    await putNewSubscriber({ ...base, status: 'ACTIVE', isDemo: true, simulationOnly: true }, deps);
    deps.log.info('suscriptor_creado', { subscriberId, channel: 'SIMULATED' });
    return json(201, { subscriberId, status: 'ACTIVE', simulationOnly: true, next: { type: 'NONE' } });
  }

  if (input.channel === 'TELEGRAM') {
    await putNewSubscriber({ ...base, status: 'PENDING', isDemo: false }, deps);
    const bot = process.env.TELEGRAM_BOT_USERNAME || 'AvisoAndinoBot';
    deps.log.info('suscriptor_creado', { subscriberId, channel: 'TELEGRAM' });
    return json(201, {
      subscriberId,
      status: 'PENDING',
      next: { type: 'TELEGRAM_DEEPLINK', telegramUrl: `https://t.me/${bot}?start=${activationCode}` },
    });
  }

  // SMS: en el sandbox solo números verificados (sms/allowlist). No se envía SMS de bienvenida:
  // la confirmación de cada aviso es por el enlace /c/:code ("Recibí el aviso").
  const phone = input.phone!;
  const params = await ssmValues(['secrets/phoneHmacKey', 'secrets/phoneEncKey', 'sms/allowlist'], deps);
  const hmacKey = params.get('secrets/phoneHmacKey');
  const encKey = params.get('secrets/phoneEncKey');
  if (!hmacKey || !encKey) return smsNotAvailable();
  const phoneHash = hashPhone(phone, hmacKey);
  const existing = await deps.ddb.send(new QueryCommand({
    TableName: requiredEnv('SUBSCRIBERS_TABLE'),
    IndexName: 'byPhoneHash',
    KeyConditionExpression: 'phoneHash = :hash',
    ExpressionAttributeValues: { ':hash': phoneHash },
    Limit: 1,
  }));
  if (existing.Items?.length) {
    return json(409, { error: { code: 'ALREADY_REGISTERED', message: 'Este número ya está registrado.' } });
  }
  if (!safeStringArray(params.get('sms/allowlist')).includes(phone)) return smsNotAvailable();
  const phoneMasked = maskPhone(phone);
  await putNewSubscriber({
    ...base,
    status: 'ACTIVE',
    isDemo: false,
    phoneHash,
    phoneEnc: encryptPhone(phone, encKey),
    phoneMasked,
    smsWelcomeSent: false,
  }, deps);
  deps.log.info('suscriptor_creado', { subscriberId, channel: 'SMS', phoneMasked });
  return json(201, { subscriberId, status: 'ACTIVE', phoneMasked, next: { type: 'SMS_LINK' } });
}

function smsNotAvailable(): APIGatewayProxyResultV2 {
  return json(422, {
    error: {
      code: 'SMS_NOT_AVAILABLE',
      message: 'Por ahora el SMS solo llega a números verificados. Usa Telegram o el modo solo simulación.',
    },
  });
}

async function putNewSubscriber(item: Record<string, unknown>, deps: ApiDependencies): Promise<void> {
  await deps.ddb.send(new PutCommand({
    TableName: requiredEnv('SUBSCRIBERS_TABLE'),
    Item: item,
    ConditionExpression: 'attribute_not_exists(subscriberId)',
  }));
}

// ---------------------------------------------------------------------------
// Replay (POST /replay) — pipeline real: ingest -> matcher (reglas + dedupe) -> SQS -> sender
// ---------------------------------------------------------------------------

/** Colegio rural 40383 (Huambo, Caylloma, Arequipa): Nivel 3 en el mapa 230_1 (fixtures/README.md). */
export const DEMO_SEED = {
  subscriberId: 'DEMO-IE40383',
  status: 'ACTIVE',
  channel: 'SIMULATED',
  role: 'DIRECTOR',
  lat: -15.73,
  lon: -72.108,
  centroPoblado: 'HUAMBO',
  distrito: 'HUAMBO',
  departamento: 'AREQUIPA',
  minLevel: 3,
  hazards: ['HELADA', 'FRIAJE', 'LLUVIA', 'NEVADA'],
  isDemo: true,
  demoSeed: true,
  simulationOnly: true,
  consentVersion: 'demo',
} as const;

const PUBLIC_REPLAYS_PER_DAY = 60;

async function startReplay(
  event: APIGatewayProxyEventV2,
  deps: ApiDependencies,
): Promise<APIGatewayProxyResultV2> {
  const parsed = replayRequestSchema.safeParse(parseJson(event.body));
  if (!parsed.success) return validationError('Datos de replay inválidos');
  const input = parsed.data;
  const params = await ssmValues(['replay/allowlist', 'replay/demoKey'], deps);
  if (!safeStringArray(params.get('replay/allowlist')).includes(`${input.year}-${input.nroAviso}`)) {
    return json(403, { error: { code: 'REPLAY_NOT_ALLOWED', message: 'Ese aviso no está habilitado para la demo.' } });
  }
  const supplied = headerValue(event, 'x-demo-key');
  const demoKey = params.get('replay/demoKey') ?? '';
  const trusted = Boolean(supplied) && demoKey.length >= 16 && safeEqual(supplied!, demoKey);
  if (supplied && !trusted) {
    deps.log.warn('demo_key_invalida');
    return json(403, { error: { code: 'INVALID_DEMO_KEY', message: 'Clave de demo inválida.' } });
  }
  if (input.realSmsSubscriberId && !trusted) {
    return json(403, { error: { code: 'DEMO_KEY_REQUIRED', message: 'El SMS real requiere la clave de demo.' } });
  }

  const now = deps.now();
  const startedAt = now.toISOString();
  if (!trusted) {
    // Visitantes públicos: solo simulación y tope diario de replays.
    try {
      await deps.ddb.send(new UpdateCommand({
        TableName: requiredEnv('STATS_TABLE'),
        Key: { statsPk: 'REPLAYS', statsSk: `DAY#${limaDate(now)}` },
        UpdateExpression: 'ADD publicRuns :one SET #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(publicRuns) OR publicRuns < :max',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':max': PUBLIC_REPLAYS_PER_DAY,
          ':ttl': Math.floor(now.getTime() / 1000) + 3 * 24 * 60 * 60,
        },
      }));
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      return json(429, { error: { code: 'RATE_LIMITED', message: 'Se alcanzó el límite diario de demos. Intenta mañana.' } });
    }
  }

  await ensureDemoSeed(deps, now);
  const targets: string[] = [DEMO_SEED.subscriberId];
  let visitorIncluded = false;
  if (input.subscriberId) {
    const visitor = await getSubscriber(input.subscriberId, deps);
    if (visitor?.isDemo === true && visitor.channel === 'SIMULATED' && visitor.status === 'ACTIVE') {
      targets.push(input.subscriberId);
      visitorIncluded = true;
    }
  }
  const realSmsTargets: string[] = [];
  if (input.realSmsSubscriberId) {
    const target = await getSubscriber(input.realSmsSubscriberId, deps);
    if (!target || target.channel !== 'SMS' || target.status !== 'ACTIVE') {
      return json(404, { error: { code: 'NOT_FOUND', message: 'Suscriptor SMS no encontrado o inactivo.' } });
    }
    targets.push(input.realSmsSubscriberId);
    realSmsTargets.push(input.realSmsSubscriberId);
  }

  const runId = `R-${ulid(now)}`;
  const mode = realSmsTargets.length ? 'REAL_SMS' : 'SIMULATION';
  const ttl = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60;
  const meta = {
    runId,
    startedAt,
    year: input.year,
    nroAviso: input.nroAviso,
    mode,
    targets: targets.length,
    visitorIncluded,
    ...(input.simulatedNow ? { simulatedNow: input.simulatedNow } : {}),
    ttl,
  };
  await deps.ddb.send(new PutCommand({
    TableName: requiredEnv('STATS_TABLE'),
    Item: { statsPk: `RUN#${runId}`, statsSk: 'META', ...meta },
  }));
  await deps.ddb.send(new PutCommand({
    TableName: requiredEnv('STATS_TABLE'),
    Item: { statsPk: 'RUNS', statsSk: `${startedAt}#${runId}`, ...meta },
  }));
  const lambda = deps.lambda ?? new LambdaClient({});
  await lambda.send(new InvokeCommand({
    FunctionName: requiredEnv('INGEST_FUNCTION_NAME'),
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      mode: 'replay',
      year: input.year,
      nroAviso: input.nroAviso,
      ...(input.mapa ? { mapa: input.mapa } : {}),
      runId,
      ...(input.simulatedNow ? { simulatedNow: input.simulatedNow } : {}),
      targets,
      realSmsTargets,
      startedAt,
    })),
  }));
  deps.log.info('replay_iniciado', { runId, mode, targets: targets.length, trusted });
  return json(202, {
    runId,
    status: 'RUNNING',
    mode,
    startedAt,
    pollUrl: `/api/replay/${runId}/deliveries`,
    metricsUrl: `/api/metrics?runId=${encodeURIComponent(`REPLAY#${runId}`)}`,
  });
}

async function ensureDemoSeed(deps: ApiDependencies, now: Date): Promise<void> {
  try {
    await deps.ddb.send(new PutCommand({
      TableName: requiredEnv('SUBSCRIBERS_TABLE'),
      Item: { ...DEMO_SEED, createdAt: now.toISOString(), consentAt: now.toISOString() },
      ConditionExpression: 'attribute_not_exists(subscriberId)',
    }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
  }
}

async function getSubscriber(subscriberId: string, deps: ApiDependencies): Promise<Record<string, unknown> | undefined> {
  const result = await deps.ddb.send(new GetCommand({
    TableName: requiredEnv('SUBSCRIBERS_TABLE'),
    Key: { subscriberId },
  }));
  return result.Item;
}

// ---------------------------------------------------------------------------
// Teléfono virtual (GET /replay/{runId}/deliveries)
// ---------------------------------------------------------------------------

async function replayDeliveries(
  event: APIGatewayProxyEventV2,
  deps: ApiDependencies,
): Promise<APIGatewayProxyResultV2> {
  const runId = event.pathParameters?.runId?.replace(/^REPLAY#/, '');
  if (!isRunId(runId)) return validationError('runId inválido');
  const mine = event.queryStringParameters?.subscriberId;
  const [metaResult, totalResult, deliveriesResult] = await Promise.all([
    deps.ddb.send(new GetCommand({ TableName: requiredEnv('STATS_TABLE'), Key: { statsPk: `RUN#${runId}`, statsSk: 'META' } })),
    deps.ddb.send(new GetCommand({ TableName: requiredEnv('STATS_TABLE'), Key: { statsPk: `RUN#${runId}`, statsSk: 'TOTAL' } })),
    deps.ddb.send(new QueryCommand({
      TableName: requiredEnv('DELIVERIES_TABLE'),
      IndexName: 'byRun',
      KeyConditionExpression: 'runId = :runId',
      ExpressionAttributeValues: { ':runId': `REPLAY#${runId}` },
      Limit: 50,
    })),
  ]);
  if (!metaResult.Item) return json(404, { error: { code: 'NOT_FOUND', message: 'Replay no encontrado' } });
  const meta = metaResult.Item;
  const totals = totalResult.Item ?? {};
  const items = (deliveriesResult.Items ?? []).map((item) => ({
    ...deliveryView(item, String(meta.startedAt)),
    text: item.text,
    // El código solo se expone para mensajes simulados (el SMS real se confirma desde el teléfono).
    ...(item.channel === 'SIMULATED' && typeof item.confirmCode === 'string' ? { confirmCode: item.confirmCode } : {}),
    mine: typeof mine === 'string' && item.subscriberId === mine,
    demoSeed: item.isDemoSeed === true,
  }));
  return json(200, {
    runId: `REPLAY#${runId}`,
    meta: {
      startedAt: meta.startedAt,
      mode: meta.mode,
      year: meta.year,
      nroAviso: meta.nroAviso,
      targets: meta.targets,
      simulatedNow: items.find((item) => item.simulatedNow)?.simulatedNow ?? meta.simulatedNow ?? null,
    },
    totals: {
      sent: numberOf(totals.sent),
      skipped: numberOf(totals.skipped),
      confirmed: numberOf(totals.confirmed),
      delivered: numberOf(totals.delivered),
      failed: numberOf(totals.failed),
      lastSkipReason: totals.lastSkipReason ?? null,
    },
    items,
  });
}

function deliveryView(item: Record<string, unknown>, replayStartedAt?: string) {
  const sentAt = typeof item.sentAt === 'string' ? item.sentAt : undefined;
  const start = replayStartedAt ?? (typeof item.replayStartedAt === 'string' ? item.replayStartedAt : undefined);
  return {
    channel: item.channel,
    status: item.status,
    template: item.template,
    tmin: item.tmin ?? null,
    level: item.level,
    color: item.color,
    title: item.title,
    lugar: item.lugar,
    fechas: item.fechas,
    nroAviso: item.nroAviso,
    year: item.year,
    createdAt: item.createdAt,
    sentAt: sentAt ?? null,
    confirmedAt: item.confirmedAt ?? null,
    confirmChannel: item.confirmChannel ?? null,
    phone: typeof item.destinationMasked === 'string' ? item.destinationMasked : (item.phoneMasked ?? 'SIMULADO'),
    segments: item.segments,
    encoding: item.encoding,
    simulatedReason: item.simulatedReason ?? null,
    providerEventType: item.providerEventType ?? null,
    simulatedNow: item.simulatedNow ?? null,
    latencyFromReplayStartSec:
      sentAt && start ? Math.max(0, Math.round((Date.parse(sentAt) - Date.parse(start)) / 1000)) : null,
  };
}

// ---------------------------------------------------------------------------
// Panel (GET /panel): solo datos reales de DynamoDB; producción y replay separados.
// ---------------------------------------------------------------------------

async function panel(deps: ApiDependencies): Promise<APIGatewayProxyResultV2> {
  const statsName = requiredEnv('STATS_TABLE');
  const deliveriesName = requiredEnv('DELIVERIES_TABLE');
  const [globalResult, runsResult, liveResult, subscribersResult] = await Promise.all([
    deps.ddb.send(new GetCommand({ TableName: statsName, Key: { statsPk: 'GLOBAL', statsSk: 'TOTAL' } })),
    deps.ddb.send(new QueryCommand({
      TableName: statsName,
      KeyConditionExpression: 'statsPk = :runs',
      ExpressionAttributeValues: { ':runs': 'RUNS' },
      ScanIndexForward: false,
      Limit: 10,
    })),
    deps.ddb.send(new QueryCommand({
      TableName: deliveriesName,
      IndexName: 'byRun',
      KeyConditionExpression: 'runId = :live',
      ExpressionAttributeValues: { ':live': 'LIVE' },
      ScanIndexForward: false,
      Limit: 50,
    })),
    deps.ddb.send(new QueryCommand({
      TableName: requiredEnv('SUBSCRIBERS_TABLE'),
      IndexName: 'byStatus',
      KeyConditionExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status', '#channel': 'channel' },
      ExpressionAttributeValues: { ':active': 'ACTIVE' },
      ProjectionExpression: 'isDemo, demoSeed, #channel',
    })),
  ]);

  const global = globalResult.Item ?? {};
  const liveItems = liveResult.Items ?? [];
  const liveSent = liveItems.filter((item) => typeof item.sentAt === 'string');
  const production = {
    sent: numberOf(global.sent),
    confirmed: numberOf(global.confirmed),
    confirmedPct: pct(numberOf(global.confirmed), numberOf(global.sent)),
    delivered: numberOf(global.delivered),
    failed: numberOf(global.failed),
    latency: {
      // SENAMHI publica solo la fecha de emisión: cota superior desde las 00:00 (Lima) de ese día.
      publicationToSendMin: percentiles(liveSent
        .filter((item) => typeof item.fechaEmi === 'string')
        .map((item) => (Date.parse(String(item.sentAt)) - Date.parse(`${String(item.fechaEmi)}T05:00:00Z`)) / 60000)),
      detectToSendSec: percentiles(liveSent.map((item) => numberOf(item.latencyDetectToSendSec))),
    },
    recent: liveItems.slice(0, 10).map((item) => deliveryView(item)),
  };

  const runs = runsResult.Items ?? [];
  const runKeys = runs.map((run) => ({ statsPk: `RUN#${String(run.runId)}`, statsSk: 'TOTAL' }));
  const totalsById = new Map<string, Record<string, unknown>>();
  if (runKeys.length) {
    const batch = await deps.ddb.send(new BatchGetCommand({ RequestItems: { [statsName]: { Keys: runKeys } } }));
    for (const item of batch.Responses?.[statsName] ?? []) totalsById.set(String(item.statsPk).slice(4), item);
  }
  const replayDeliveriesList = (await Promise.all(runs.slice(0, 5).map(async (run) => {
    const result = await deps.ddb.send(new QueryCommand({
      TableName: deliveriesName,
      IndexName: 'byRun',
      KeyConditionExpression: 'runId = :runId',
      ExpressionAttributeValues: { ':runId': `REPLAY#${String(run.runId)}` },
      Limit: 25,
    }));
    return (result.Items ?? []).map((item) => ({ ...deliveryView(item, String(run.startedAt)), runId: run.runId }));
  }))).flat().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const runViews = runs.map((run) => {
    const totals = totalsById.get(String(run.runId)) ?? {};
    return {
      runId: run.runId,
      startedAt: run.startedAt,
      mode: run.mode,
      year: run.year,
      nroAviso: run.nroAviso,
      sent: numberOf(totals.sent),
      confirmed: numberOf(totals.confirmed),
      skipped: numberOf(totals.skipped),
      delivered: numberOf(totals.delivered),
      smsSent: numberOf(totals.smsSent),
    };
  });
  const replaySent = runViews.reduce((sum, run) => sum + run.sent, 0);
  const replayConfirmed = runViews.reduce((sum, run) => sum + run.confirmed, 0);
  const replay = {
    runsShown: runViews.length,
    sent: replaySent,
    confirmed: replayConfirmed,
    confirmedPct: pct(replayConfirmed, replaySent),
    realSmsSent: runViews.reduce((sum, run) => sum + run.smsSent, 0),
    latency: {
      replayStartToSendSec: percentiles(replayDeliveriesList
        .map((item) => item.latencyFromReplayStartSec)
        .filter((value): value is number => typeof value === 'number')),
    },
    runs: runViews,
    recent: replayDeliveriesList.slice(0, 10),
  };

  let warning: Record<string, unknown> | null = null;
  const latest = runs[0];
  if (latest) {
    const result = await deps.ddb.send(new QueryCommand({
      TableName: requiredEnv('WARNINGS_TABLE'),
      IndexName: 'byAviso',
      KeyConditionExpression: 'avisoKey = :key',
      ExpressionAttributeValues: { ':key': `REPLAY#${String(latest.runId)}#SENAMHI#${String(latest.year)}#${String(latest.nroAviso)}` },
      Limit: 3,
    }));
    const first = result.Items?.[0];
    if (first) {
      warning = {
        nroAviso: first.nroAviso,
        year: first.year,
        title: first.title,
        color: first.listLevelColor ?? null,
        hazard: first.hazard,
        fechaEmi: first.fechaEmi,
        fechIni: first.fechIni,
        fechFin: first.fechFin,
        maxLevel: first.maxLevel,
        maps: (result.Items ?? []).map((item) => item.mapa),
        dataSource: first.replayDataSource ?? null,
        simulatedNow: first.simulatedNow ?? null,
        officialUrl: first.detailUrl ?? 'https://www.senamhi.gob.pe/?p=aviso-meteorologico',
      };
    }
  }
  const subs = subscribersResult.Items ?? [];
  return json(200, {
    generatedAt: deps.now().toISOString(),
    subscribers: {
      active: subs.filter((item) => item.demoSeed !== true).length,
      simulationOnly: subs.filter((item) => item.isDemo === true && item.demoSeed !== true).length,
      sms: subs.filter((item) => item.channel === 'SMS').length,
    },
    production,
    replay,
    warning,
  });
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function ssmValues(names: string[], deps: ApiDependencies): Promise<Map<string, string>> {
  const prefix = requiredEnv('SSM_PREFIX').replace(/\/$/, '');
  const response = await deps.ssm.send(new GetParametersCommand({
    Names: names.map((name) => `${prefix}/${name}`),
    WithDecryption: true,
  }));
  return new Map((response.Parameters ?? []).map((parameter) => [
    String(parameter.Name).slice(prefix.length + 1),
    parameter.Value ?? '',
  ]));
}

function safeStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function headerValue(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const entry = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return entry?.[1] || undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

export function ulid(now: Date): string {
  let time = now.getTime();
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = CROCKFORD[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const random = [...randomBytes(16)].map((byte) => CROCKFORD[byte % 32]).join('');
  return timePart + random;
}

function confirmCodeValue(): string {
  return [...randomBytes(6)].map((byte) => CROCKFORD[byte % 32]).join('');
}

function isRunId(value: unknown): value is string {
  return typeof value === 'string' && /^R-[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

function pct(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 1000) / 10;
}

function percentiles(values: number[]): { p50: number; p90: number; max: number; n: number } | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  return { p50: Math.round(at(0.5)), p90: Math.round(at(0.9)), max: Math.round(sorted.at(-1)!), n: sorted.length };
}

function limaDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

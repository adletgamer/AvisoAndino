import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  normalizeIndeci,
  normalizeWfs,
  type NormalizedWarning,
} from "@aviso/core";
import { fetchAvisoList, type AvisoRow } from "./senamhiList.js";
import { fetchAvisoMap } from "./senamhiWfs.js";
import { fetchIndeci } from "./indeci.js";
import { loadListRow, loadMap } from "./replaySnapshots.js";

const logger = new Logger({ serviceName: "ingest" });
const metrics = new Metrics({
  namespace: "AvisoAndino",
  serviceName: "ingest",
});

type WarningCollection = FeatureCollection<
  Polygon | MultiPolygon,
  Record<string, unknown>
>;

export type IngestEvent =
  | { mode?: "scheduled" }
  | {
      mode: "replay";
      year: number;
      nroAviso: number;
      mapa?: number;
      runId: string;
      simulatedNow?: string;
      /** Suscriptores a evaluar (demo + visitante). */
      targets?: string[];
      /** Subconjunto autorizado con x-demo-key para SMS real (sender vuelve a validar). */
      realSmsTargets?: string[];
      startedAt?: string;
    };

export interface IngestResult {
  avisosActivos: number;
  warningsNew: number;
  warningsChanged: number;
  source: "SENAMHI_WFS" | "INDECI_PP24H" | "REPLAY";
}

export interface IngestDependencies {
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  sqs: SQSClient;
  fetchList: () => Promise<AvisoRow[]>;
  fetchMap: (
    nro: number,
    mapa: number,
    year: number,
  ) => Promise<WarningCollection | null>;
  fetchFallback: () => Promise<WarningCollection>;
  loadReplayRow?: (nro: number, year: number) => AvisoRow | undefined;
  loadReplayMap?: (nro: number, mapa: number, year: number) => WarningCollection | undefined;
  now: () => Date;
  hash: (value: string) => string;
  log: Pick<Logger, "info" | "warn" | "error">;
  metric: (name: string, value?: number) => void;
}

let consecutiveEmptyLists = 0;

export function clearIngestState(): void {
  consecutiveEmptyLists = 0;
}

const defaultDependencies: IngestDependencies = {
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  s3: new S3Client({}),
  sqs: new SQSClient({}),
  fetchList: () => fetchAvisoList(),
  fetchMap: (nro, mapa, year) => fetchAvisoMap(nro, mapa, year),
  fetchFallback: () => fetchIndeci(),
  loadReplayRow: (nro, year) => loadListRow(nro, year),
  loadReplayMap: (nro, mapa, year) => loadMap(nro, mapa, year),
  now: () => new Date(),
  hash: (value) => createHash("sha256").update(value).digest("hex"),
  log: logger,
  metric: (name, value = 1) => metrics.addMetric(name, MetricUnit.Count, value),
};

export function createIngestHandler(
  deps: IngestDependencies = defaultDependencies,
) {
  return async (event: IngestEvent = {}): Promise<IngestResult> => {
    const mode = event.mode ?? 'scheduled';
    // El replay (invocado solo por la API) funciona con la ingesta programada apagada.
    const enabled =
      deps !== defaultDependencies ||
      (mode === 'replay'
        ? process.env.REPLAY_ENABLED !== 'false'
        : process.env.INGEST_ENABLED === 'true');
    deps.log.info('inicio_ingesta', { mode, enabled });
    if (!enabled) {
      deps.log.info('ingesta_deshabilitada', { mode });
      return {
        avisosActivos: 0,
        warningsNew: 0,
        warningsChanged: 0,
        source: event.mode === 'replay' ? 'REPLAY' : 'SENAMHI_WFS',
      };
    }
    try {
      if (event.mode !== "replay") await requeueDueDeliveries(deps);
      const result =
        event.mode === "replay"
          ? await ingestReplay(event, deps)
          : await ingestScheduled(deps);
      deps.metric("AvisosActivos", result.avisosActivos);
      deps.metric("WarningsNew", result.warningsNew);
      deps.metric("WarningsChanged", result.warningsChanged);
      return result;
    } finally {
      if (deps === defaultDependencies) metrics.publishStoredMetrics();
    }
  };
}

export const handler = createIngestHandler();

async function ingestScheduled(
  deps: IngestDependencies,
): Promise<IngestResult> {
  let activeRows: AvisoRow[];
  try {
    const rows = await deps.fetchList();
    activeRows = rows.filter(
      (row) => row.status === "emitido" || row.status === "vigente",
    );
    consecutiveEmptyLists =
      activeRows.length === 0 ? consecutiveEmptyLists + 1 : 0;
    if (activeRows.length === 0 && consecutiveEmptyLists < 2) {
      return {
        avisosActivos: 0,
        warningsNew: 0,
        warningsChanged: 0,
        source: "SENAMHI_WFS",
      };
    }
    if (activeRows.length === 0) return ingestFallback(deps);
  } catch (error) {
    deps.metric("FetchErrors");
    deps.log.warn("fallback_indeci", { reason: errorMessage(error) });
    return ingestFallback(deps);
  }

  const tasks = activeRows.flatMap((row) =>
    [1, 2, 3].map((mapa) => ({ row, mapa })),
  );
  const outcomes = await mapPool(tasks, 3, async ({ row, mapa }) => {
    try {
      const collection = await deps.fetchMap(row.nro, mapa, row.year);
      if (!collection) return undefined;
      const warning = normalizeWfs(
        collection as Parameters<typeof normalizeWfs>[0],
        row,
        deps.hash,
      );
      return persistWarning(warning, collection, row.color, undefined, deps);
    } catch (error) {
      deps.metric("FetchErrors");
      deps.log.error("error_wfs", {
        nroAviso: row.nro,
        mapa,
        error: errorMessage(error),
      });
      return undefined;
    }
  });
  return summarize(activeRows.length, outcomes, "SENAMHI_WFS");
}

async function ingestFallback(deps: IngestDependencies): Promise<IngestResult> {
  deps.log.warn("fallback_indeci", { source: "INDECI_PP24H" });
  deps.metric("FallbackUsed");
  const collection = await deps.fetchFallback();
  const warning = normalizeIndeci(
    collection as Parameters<typeof normalizeIndeci>[0],
    deps.hash,
  );
  const outcome = await persistWarning(
    warning,
    collection,
    undefined,
    undefined,
    deps,
  );
  return summarize(1, [outcome], "INDECI_PP24H");
}

async function ingestReplay(
  event: Extract<IngestEvent, { mode: "replay" }>,
  deps: IngestDependencies,
): Promise<IngestResult> {
  if (
    !event.runId ||
    !Number.isInteger(event.year) ||
    !Number.isInteger(event.nroAviso)
  ) {
    throw new Error("Evento replay inválido");
  }
  // 1) Snapshot real guardado en el repo (fila oficial de la lista + mapa WFS).
  // 2) Si no existe: fuente oficial (lista SENAMHI + WFS), igual que la ingesta. Nunca se inventan datos.
  const requested = event.mapa ? [event.mapa] : [1, 2, 3];
  let row = deps.loadReplayRow?.(event.nroAviso, event.year);
  let source: "snapshot" | "official" = "snapshot";
  let maps: Array<{ mapa: number; collection: WarningCollection }> = [];
  if (row) {
    maps = requested
      .map((mapa) => ({ mapa, collection: deps.loadReplayMap?.(event.nroAviso, mapa, event.year) }))
      .filter((entry): entry is { mapa: number; collection: WarningCollection } => Boolean(entry.collection));
  }
  if (!row || maps.length === 0) {
    source = "official";
    row = (await deps.fetchList()).find((candidate) => candidate.nro === event.nroAviso && candidate.year === event.year);
    if (!row) throw new Error(`Aviso ${event.year}-${event.nroAviso} no está en la lista oficial de SENAMHI`);
    const fetched = await mapPool(requested, 3, async (mapa) => ({ mapa, collection: await deps.fetchMap(event.nroAviso, mapa, event.year) }));
    maps = fetched.filter((entry): entry is { mapa: number; collection: WarningCollection } => Boolean(entry.collection));
    if (maps.length === 0) throw new Error(`WFS sin mapas para ${event.year}-${event.nroAviso}`);
  }
  const listRow = row;
  const simulatedNow = event.simulatedNow ?? `${listRow.emision}T17:00:00.000Z`; // mediodía Lima del día de emisión
  deps.log.info("replay_datos", { runId: event.runId, source, maps: maps.map((entry) => entry.mapa), simulatedNow });
  const outcomes = await mapPool(maps, 3, async ({ collection }) => {
    const normalized = normalizeWfs(
      collection as Parameters<typeof normalizeWfs>[0],
      listRow,
      deps.hash,
    );
    const prefix = `REPLAY#${event.runId}#`;
    const warning: NormalizedWarning = {
      ...normalized,
      warningId: `${prefix}${normalized.warningId}`,
      avisoKey: `${prefix}${normalized.avisoKey}`,
      source: "REPLAY",
    };
    return persistWarning(warning, collection, listRow.color, event.runId, deps, {
      simulatedNow,
      replayTargets: event.targets ?? [],
      replayRealSms: event.realSmsTargets ?? [],
      replayStartedAt: event.startedAt ?? deps.now().toISOString(),
      replayDataSource: source,
    });
  });
  return summarize(1, outcomes, "REPLAY");
}

type PersistOutcome = "new" | "changed" | "same";

async function persistWarning(
  warning: NormalizedWarning,
  collection: WarningCollection,
  listLevelColor: AvisoRow["color"] | undefined,
  replayRunId: string | undefined,
  deps: IngestDependencies,
  replayExtra: Record<string, unknown> = {},
): Promise<PersistOutcome> {
  const tableName = requiredEnv("WARNINGS_TABLE");
  const bucket = requiredEnv("SNAPSHOTS_BUCKET");
  const queueUrl = requiredEnv("MATCH_QUEUE_URL");
  const existing = await deps.ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { warningId: warning.warningId },
      ConsistentRead: true,
    }),
  );
  if (existing.Item?.contentHash === warning.contentHash) return "same";

  const now = deps.now().toISOString();
  const safeTime = now.replace(/[:.]/g, "-");
  const s3Key = replayRunId
    ? `replay/${replayRunId}/${warning.year}/${warning.nroAviso}_${warning.mapa}/${safeTime}.geojson.gz`
    : warning.source === "INDECI_PP24H"
      ? `snapshots/indeci/${warning.fechaEmi}/${safeTime}.geojson.gz`
      : `snapshots/senamhi/${warning.year}/${warning.nroAviso}_${warning.mapa}/${safeTime}.geojson.gz`;
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: gzipSync(JSON.stringify(collection)),
      ContentType: "application/geo+json",
      ContentEncoding: "gzip",
    }),
  );
  const levels = [...new Set(warning.areas.map((area) => area.level))].sort();
  await deps.ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ...warning,
        areas: warning.areas.map(({ level, bbox }) => ({ level, bbox })),
        levels,
        maxLevel: Math.max(...levels),
        s3Key,
        firstSeenAt: existing.Item?.firstSeenAt ?? now,
        updatedAt: now,
        // Los replays no son avisos vigentes: no aparecen en GET /alerts.
        ...(replayRunId ? {} : { activeFlag: "1" }),
        detailUrl: "https://www.senamhi.gob.pe/?p=aviso-meteorologico",
        ttl: Math.floor(deps.now().getTime() / 1000) + 90 * 24 * 60 * 60,
        ...(listLevelColor ? { listLevelColor } : {}),
        ...(replayRunId ? { replayRunId, ...replayExtra } : {}),
      },
    }),
  );
  await deps.sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ warningId: warning.warningId }),
    }),
  );
  deps.log.info("warning_guardado", {
    warningId: warning.warningId,
    changed: Boolean(existing.Item),
  });
  return existing.Item ? "changed" : "new";
}

async function requeueDueDeliveries(deps: IngestDependencies): Promise<void> {
  const tableName = process.env.DELIVERIES_TABLE;
  const queueUrl = process.env.SEND_QUEUE_URL;
  if (!tableName || !queueUrl) return;
  const now = deps.now().toISOString();
  const due = await deps.ddb.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "#status = :scheduled AND scheduleAt <= :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":scheduled": "SCHEDULED", ":now": now },
      ProjectionExpression: "deliveryId",
    }),
  );
  for (const item of due.Items ?? []) {
    if (typeof item.deliveryId !== "string") continue;
    try {
      await deps.ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { deliveryId: item.deliveryId },
          UpdateExpression: "SET #status = :pending",
          ConditionExpression: "#status = :scheduled AND scheduleAt <= :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":pending": "PENDING",
            ":scheduled": "SCHEDULED",
            ":now": now,
          },
        }),
      );
      await deps.sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ deliveryId: item.deliveryId }),
        }),
      );
    } catch (error) {
      if (
        (error as { name?: string }).name !== "ConditionalCheckFailedException"
      )
        throw error;
    }
  }
}

function summarize(
  avisosActivos: number,
  outcomes: Array<PersistOutcome | undefined>,
  source: IngestResult["source"],
): IngestResult {
  return {
    avisosActivos,
    warningsNew: outcomes.filter((outcome) => outcome === "new").length,
    warningsChanged: outcomes.filter((outcome) => outcome === "changed").length,
    source,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await work(items[index]!);
      }
    }),
  );
  return results;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

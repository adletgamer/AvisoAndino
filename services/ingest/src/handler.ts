// Lambda ingest: EventBridge Scheduler (cada 15 min) o invocación directa {mode:'replay',...}.
// Ver prompts/02-ingestor.md y docs/RESEARCH.md §1 (endpoints y campos verificados).
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'ingest' });

export const SENAMHI_LIST_URL = 'https://www.senamhi.gob.pe/?p=aviso-meteorologico';
export const senamhiWfsUrl = (nro: number, mapa: number, year: number) =>
  `https://idesep.senamhi.gob.pe/geoserver/g_aviso/ows?service=WFS&version=1.0.0&request=GetFeature` +
  `&typeName=g_aviso:view_aviso&outputFormat=application/json&viewparams=qry:${nro}_${mapa}_${year}`;
export const INDECI_PP24H_URL =
  'https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer/5/query' +
  '?where=1%3D1&outFields=NIVEL,FECHA&returnGeometry=true&outSR=4326&f=geojson&maxAllowableOffset=0.005&geometryPrecision=5';

export type IngestEvent =
  | { mode?: 'scheduled' }
  | { mode: 'replay'; year: number; nroAviso: number; mapa?: number; runId: string; simulatedNow?: string };

export interface IngestResult {
  avisosActivos: number;
  warningsNew: number;
  warningsChanged: number;
  source: 'SENAMHI_WFS' | 'INDECI_PP24H' | 'REPLAY';
}

export async function handler(event: IngestEvent): Promise<IngestResult> {
  logger.info('ingest start', { mode: event.mode ?? 'scheduled' });
  // TODO(prompt 02): lista -> WFS por nro/mapa -> normalize (core) -> dedup por contentHash -> S3 + DynamoDB -> SQS match-queue
  throw new Error('TODO ingest handler');
}

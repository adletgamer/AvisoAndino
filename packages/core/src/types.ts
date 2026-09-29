// Tipos de dominio compartidos (backend + web). Ver docs/DATA_MODEL.md y docs/RULES.md.
import type { Polygon, MultiPolygon } from 'geojson';

/** 1 = verde (NO es aviso), 2 = AMARILLO, 3 = NARANJA, 4 = ROJO */
export type Level = 1 | 2 | 3 | 4;
export type Hazard = 'HELADA' | 'LLUVIA' | 'FRIAJE' | 'NEVADA' | 'LLOVIZNA' | 'CALOR' | 'VIENTO' | 'DESCONOCIDO';
export type Channel = 'SMS' | 'TELEGRAM' | 'SIMULATED';
export type WarningSource = 'SENAMHI_WFS' | 'INDECI_PP24H' | 'REPLAY';
export type LonLat = [lon: number, lat: number];
export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface WarningArea {
  level: Level;
  geometry: Polygon | MultiPolygon;
  bbox: BBox;
}

export interface NormalizedWarning {
  warningId: string; // "SENAMHI#2026#388#2"
  avisoKey: string; // "SENAMHI#2026#388"
  source: WarningSource;
  year: number;
  nroAviso: number;
  mapa: number;
  codFen: number;
  hazard: Hazard;
  title: string;
  fechaEmi: string; // "2026-09-28"
  fechIni: string; // ISO UTC
  fechFin: string; // ISO UTC
  areas: WarningArea[];
  contentHash: string;
}

export interface Subscriber {
  subscriberId: string;
  status: 'PENDING' | 'ACTIVE' | 'OPTED_OUT';
  channel: Channel;
  lat: number;
  lon: number;
  centroPoblado?: string;
  distrito?: string;
  departamento?: string;
  codMod?: string;
  minLevel: 2 | 3 | 4;
  hazards: Hazard[];
  isDemo: boolean;
}

export type TemplateId =
  | 'HELADA' | 'HELADA_SIN_TMIN' | 'LLUVIA' | 'FRIAJE' | 'NEVADA' | 'GENERICO' | 'SUBE_NIVEL' | 'BIENVENIDA';

export type SkipReason =
  | 'not_active' | 'hazard_disabled' | 'expired' | 'outside_polygons' | 'below_min_level'
  | 'already_sent' | 'lower_than_sent' | 'extension_suppressed' | 'unknown_cod_fen';

export interface Decision {
  send: boolean;
  level: Level;
  template?: TemplateId;
  fechas?: string; // "30/09-02/10"
  reason?: SkipReason;
  scheduleAt?: string; // ISO; horario de silencio para nivel 2
  channelOverride?: Channel; // p. ej. SIMULATED por tope diario
  capped?: boolean;
  warningIds?: string[];
}

export interface RulesConfig {
  quietHoursLima: { start: number; end: number }; // 21 → 6
  maxSmsPerSubscriberPerDay: number; // 3
  globalSmsDailyCap: number; // 30
}

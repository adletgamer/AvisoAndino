export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';
export const SUBSCRIBER_KEY = 'aviso-andino.subscriberId';

export function storedSubscriberId(): string | undefined {
  try {
    const value = window.localStorage.getItem(SUBSCRIBER_KEY) ?? undefined;
    return value && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function storeSubscriberId(id: string): void {
  try {
    window.localStorage.setItem(SUBSCRIBER_KEY, id);
  } catch {
    // sin persistencia (modo privado)
  }
}

export interface DeliveryView {
  channel: 'SMS' | 'SIMULATED' | 'TELEGRAM';
  status: string;
  template?: string;
  tmin?: number | null;
  level?: number;
  color?: string;
  title?: string;
  lugar?: string;
  fechas?: string;
  nroAviso?: number;
  year?: number;
  createdAt?: string;
  sentAt: string | null;
  confirmedAt: string | null;
  phone: string;
  segments?: number;
  simulatedReason?: string | null;
  providerEventType?: string | null;
  simulatedNow?: string | null;
  latencyFromReplayStartSec: number | null;
  runId?: string;
}

export interface ReplayDelivery extends DeliveryView {
  text: string;
  confirmCode?: string;
  mine: boolean;
  demoSeed: boolean;
}

export interface ReplayResponse {
  runId: string;
  meta: { startedAt: string; mode: string; year: number; nroAviso: number; targets: number; simulatedNow: string | null };
  totals: { sent: number; skipped: number; confirmed: number; delivered: number; failed: number; lastSkipReason: string | null };
  items: ReplayDelivery[];
}

export interface Percentiles { p50: number; p90: number; max: number; n: number }

export interface PanelResponse {
  generatedAt: string;
  subscribers: { active: number; simulationOnly: number; sms: number };
  production: {
    sent: number; confirmed: number; confirmedPct: number | null; delivered: number; failed: number;
    latency: { publicationToSendMin: Percentiles | null; detectToSendSec: Percentiles | null };
    recent: DeliveryView[];
  };
  replay: {
    runsShown: number; sent: number; confirmed: number; confirmedPct: number | null; realSmsSent: number;
    latency: { replayStartToSendSec: Percentiles | null };
    runs: Array<{ runId: string; startedAt: string; mode: string; year: number; nroAviso: number; sent: number; confirmed: number; skipped: number; delivered: number; smsSent: number }>;
    recent: DeliveryView[];
  };
  warning: null | {
    nroAviso: number; year: number; title: string; color: string | null; hazard: string; fechaEmi: string;
    fechIni: string; fechFin: string; maxLevel: number; maps: number[]; dataSource: string | null;
    simulatedNow: string | null; officialUrl: string;
  };
}

/** Fecha/hora en Lima para mostrar (con etiqueta de zona). */
export function limaTime(iso: string | null | undefined, locale: 'es' | 'en', withDate = true): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${new Intl.DateTimeFormat(locale === 'es' ? 'es-PE' : 'en-US', {
    timeZone: 'America/Lima',
    ...(withDate ? { day: '2-digit', month: 'short', year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: withDate ? undefined : '2-digit',
  }).format(date)} (Lima)`;
}

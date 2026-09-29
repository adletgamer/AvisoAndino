import type { Decision, NormalizedWarning, RulesConfig, Subscriber } from './types.js';
import { effectiveLevel } from './geo.js';
import { formatFechas } from './templates.js';

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  quietHoursLima: { start: 21, end: 6 },
  maxSmsPerSubscriberPerDay: 3,
  globalSmsDailyCap: 30,
};

export interface DecideInput {
  subscriber: Subscriber;
  /** Todos los mapas (días) del mismo aviso (mismo avisoKey). */
  warningGroup: NormalizedWarning[];
  /** Niveles ya enviados a este suscriptor para este aviso. */
  alreadySentLevels: number[];
  sentTodayToSubscriber: number;
  globalSentToday: number;
  now: Date;
  config?: RulesConfig;
  /** Último aviso del mismo nivel al que este título declara extensión. */
  extensionPreviousSentAt?: Date;
}

/**
 * Decisión determinista. NUNCA llamar a un LLM aquí.
 * TODO(prompt 03): implementar docs/RULES.md §2 puntos 1-9 y casos de prueba §7.
 */
export function decide(input: DecideInput): Decision {
  const { subscriber, warningGroup, now } = input;
  const config = input.config ?? DEFAULT_RULES_CONFIG;
  if (subscriber.status !== 'ACTIVE') return skip('not_active');
  if (warningGroup.length === 0) return skip('outside_polygons');

  const first = warningGroup[0]!;
  if (first.hazard === 'DESCONOCIDO') return skip('unknown_cod_fen');
  if (!subscriber.hazards.includes(first.hazard)) return skip('hazard_disabled');

  const active = warningGroup.filter((warning) => now.getTime() < Date.parse(warning.fechFin));
  if (active.length === 0) return skip('expired');

  const matches = active
    .map((warning) => ({ warning, level: effectiveLevel([subscriber.lon, subscriber.lat], warning.areas) }))
    .filter(({ level }) => level > 1);
  if (matches.length === 0) return skip('outside_polygons');

  const level = Math.max(...matches.map(({ level: matchLevel }) => matchLevel)) as Decision['level'];
  if (level < subscriber.minLevel) return { ...skip('below_min_level'), level };

  const highestSent = Math.max(1, ...input.alreadySentLevels);
  if (input.alreadySentLevels.includes(level)) return { ...skip('already_sent'), level };
  if (highestSent > level) return { ...skip('lower_than_sent'), level };

  if (
    /EXTENSI/i.test(first.title) &&
    input.extensionPreviousSentAt &&
    now.getTime() - input.extensionPreviousSentAt.getTime() < 24 * 60 * 60 * 1000
  ) {
    return { ...skip('extension_suppressed'), level };
  }

  const relevant = matches.filter(({ level: matchLevel }) => matchLevel > 1).map(({ warning }) => warning);
  const fechIni = relevant.reduce((min, warning) => warning.fechIni < min ? warning.fechIni : min, relevant[0]!.fechIni);
  const fechFin = relevant.reduce((max, warning) => warning.fechFin > max ? warning.fechFin : max, relevant[0]!.fechFin);
  const escalated = input.alreadySentLevels.some((sentLevel) => sentLevel < level);
  const decision: Decision = {
    send: true,
    level,
    template: escalated ? 'SUBE_NIVEL' : templateFor(first.hazard),
    fechas: formatFechas(fechIni, fechFin),
    warningIds: relevant.map((warning) => warning.warningId),
  };

  if (level === 2 && isQuietHour(now, config)) decision.scheduleAt = nextSixAmLima(now).toISOString();
  if (
    subscriber.channel === 'SMS' &&
    (input.sentTodayToSubscriber >= config.maxSmsPerSubscriberPerDay ||
      input.globalSentToday >= config.globalSmsDailyCap)
  ) {
    decision.channelOverride = 'SIMULATED';
    decision.capped = true;
  }
  return decision;
}

function skip(reason: NonNullable<Decision['reason']>): Decision {
  return { send: false, level: 1, reason };
}

function templateFor(hazard: NormalizedWarning['hazard']): NonNullable<Decision['template']> {
  if (hazard === 'HELADA') return 'HELADA_SIN_TMIN';
  if (hazard === 'LLUVIA' || hazard === 'FRIAJE' || hazard === 'NEVADA') return hazard;
  return 'GENERICO';
}

function limaHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now));
}

function isQuietHour(now: Date, config: RulesConfig): boolean {
  const hour = limaHour(now);
  const { start, end } = config.quietHoursLima;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function nextSixAmLima(now: Date): Date {
  // Perú no usa horario de verano: 06:00 PET = 11:00 UTC.
  const shifted = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const result = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    11,
  ));
  if (result.getTime() <= now.getTime()) result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

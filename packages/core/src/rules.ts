import type { Decision, NormalizedWarning, RulesConfig, Subscriber } from './types.js';

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
}

/**
 * Decisión determinista. NUNCA llamar a un LLM aquí.
 * TODO(prompt 03): implementar docs/RULES.md §2 puntos 1-9 y casos de prueba §7.
 */
export function decide(input: DecideInput): Decision {
  throw new Error('TODO decide');
}

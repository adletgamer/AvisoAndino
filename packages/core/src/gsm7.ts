// Conjunto básico GSM 03.38 (sin tabla de extensión). Un char fuera de esto => UCS-2 (70 chars/segmento).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_SET = new Set([...GSM7_BASIC]);

export function isGsm7(s: string): boolean {
  return [...s].every((c) => GSM7_SET.has(c));
}

/**
 * Normaliza a ASCII seguro + ñ/Ñ (RULES.md §3). Quita tildes (á->a), comillas tipográficas, guiones largos y emojis.
 * TODO(prompt 03): completar mapeos (“ ” ‘ ’ – — …) y tests.
 */
export function sanitizeToGsm7(s: string): string {
  const keepEnye = s.replace(/ñ/g, '\u0000').replace(/Ñ/g, '\u0001');
  const stripped = keepEnye.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const back = stripped.replace(/\u0000/g, 'ñ').replace(/\u0001/g, 'Ñ');
  return [...back].filter((c) => GSM7_SET.has(c)).join('');
}

/** Segmentos SMS: GSM-7 160/153, UCS-2 70/67. */
export function segments(s: string): { encoding: 'GSM7' | 'UCS2'; count: number } {
  const gsm = isGsm7(s);
  const len = [...s].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return { encoding: gsm ? 'GSM7' : 'UCS2', count: len <= single ? 1 : Math.ceil(len / multi) };
}

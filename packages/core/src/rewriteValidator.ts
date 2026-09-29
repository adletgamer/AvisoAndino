import { isGsm7, sanitizeToGsm7 } from "./gsm7.js";

export interface RewriteFacts {
  COLOR: string;
  fechas: string;
  lugar: string;
  tmin?: number;
  nro?: number;
  maxBodyLength: number; // 160 - len(" Confirme: " + link)
}

export type RewriteVerdict =
  { ok: true; text: string } | { ok: false; reason: string };

/**
 * Valida la propuesta de Bedrock (RULES.md §4): GSM-7, longitud, contiene SENAMHI + COLOR + fechas,
 * sin números nuevos, sin URLs, sin frases prohibidas. Si falla -> el caller usa la plantilla.
 */
export function validateRewrite(
  candidate: string,
  facts: RewriteFacts,
): RewriteVerdict {
  const text = sanitizeToGsm7(candidate).trim();
  if (!isGsm7(text)) return { ok: false, reason: "not_gsm7" };
  if ([...text].length > facts.maxBodyLength)
    return { ok: false, reason: "too_long" };
  const upper = text.toUpperCase();
  if (!upper.includes("SENAMHI"))
    return { ok: false, reason: "missing_senamhi" };
  if (!upper.includes(facts.COLOR.toUpperCase()))
    return { ok: false, reason: "missing_color" };
  if (!text.includes(facts.fechas))
    return { ok: false, reason: "missing_dates" };
  if (
    /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|pe)(?:\/|$))/i.test(text)
  ) {
    return { ok: false, reason: "contains_url" };
  }
  const forbidden = [
    "no hay peligro",
    "cancelado",
    "cancelada",
    "tranquilo",
    "tranquila",
    "sin peligro",
  ];
  if (forbidden.some((phrase) => upper.includes(phrase.toUpperCase()))) {
    return { ok: false, reason: "forbidden_phrase" };
  }
  const allowedNumbers = new Set(
    [facts.COLOR, facts.fechas, facts.lugar, facts.tmin, facts.nro]
      .filter((value) => value !== undefined)
      .flatMap((value) => String(value).match(/-?\d+(?:[.,]\d+)?/g) ?? [])
      .map(normalizeNumber),
  );
  const numbers = text.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.some((number) => !allowedNumbers.has(normalizeNumber(number)))) {
    return { ok: false, reason: "invented_number" };
  }
  return { ok: true, text };
}

function normalizeNumber(value: string): string {
  return value.replace(",", ".").replace(/^(-?)0+(?=\d)/, "$1");
}

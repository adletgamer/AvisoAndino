export interface RewriteFacts {
  COLOR: string;
  fechas: string;
  lugar: string;
  tmin?: number;
  nro?: number;
  maxBodyLength: number; // 160 - len(" Confirme: " + link)
}

export type RewriteVerdict = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Valida la propuesta de Bedrock (RULES.md §4): GSM-7, longitud, contiene SENAMHI + COLOR + fechas,
 * sin números nuevos, sin URLs, sin frases prohibidas. Si falla -> el caller usa la plantilla.
 * TODO(prompt 03).
 */
export function validateRewrite(candidate: string, facts: RewriteFacts): RewriteVerdict {
  throw new Error('TODO validateRewrite');
}

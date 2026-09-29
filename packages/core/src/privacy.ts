/** Máscara para logs; nunca devuelve el número completo. */
export function maskPhone(phone: string): string {
  const normalized = phone.trim();
  if (normalized.length < 4) return '••••';
  const prefix = normalized.startsWith('+51') ? '+51 9' : '';
  return `${prefix}•••••${normalized.slice(-3)}`;
}

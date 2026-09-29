import { render } from '@aviso/core/src/templates.js'; // import directo: evita arrastrar zod/turf al bundle

/** Host corto para el enlace del SMS (sin https://), como lo generaría el backend. */
function linkHost(): string {
  return typeof window === 'undefined' ? 'aviso-andino' : window.location.host || 'aviso-andino';
}

/** SMS de ejemplo con la plantilla real HELADA (español, GSM-7, sin tildes). */
export function sampleWarningSms(): string {
  const link = `${linkHost()}/c/K7P2QX`;
  try {
    return render('HELADA', { COLOR: 'NARANJA', fechas: '30/09-01/10', lugar: 'CHARAMAYA', tmin: -9, link });
  } catch {
    return render('HELADA', { COLOR: 'NARANJA', fechas: '30/09-01/10', lugar: 'CHARAMAYA', tmin: -9, link: 'aviso.pe/c/K7P2QX' });
  }
}

export function welcomeSms(place: string): string {
  const lugar = place.trim() || 'SU COLEGIO';
  try {
    return render('BIENVENIDA', { lugar, link: `${linkHost()}/b/Q7M2PX` });
  } catch {
    return render('BIENVENIDA', { lugar, link: 'aviso.pe/b/Q7M2PX' });
  }
}

const COLOR_EN: Record<string, string> = { AMARILLO: 'YELLOW', NARANJA: 'ORANGE', ROJO: 'RED' };

/** Traducción al inglés SOLO para el caption (el SMS real siempre va en español). */
export function translateSms(delivery: { template?: string; color?: string; fechas?: string; lugar?: string; tmin?: number | null; nroAviso?: number }): string {
  const color = COLOR_EN[delivery.color ?? ''] ?? delivery.color ?? '';
  const where = `${delivery.fechas ?? ''} in ${delivery.lugar ?? ''}`;
  switch (delivery.template) {
    case 'HELADA':
      return `SENAMHI ${color}: frost ${where}. Forecast low ${delivery.tmin ?? ''} °C. Keep children and animals warm. Confirm: <link>`;
    case 'HELADA_SIN_TMIN':
      return `SENAMHI ${color}: frost ${where}. Keep children and animals warm. Confirm: <link>`;
    case 'LLUVIA':
      return `SENAMHI ${color}: heavy rain ${where}. Watch for mudslides and rivers. Confirm: <link>`;
    case 'FRIAJE':
      return `SENAMHI ${color}: cold spell and rain ${where}. Keep children warm. Confirm: <link>`;
    case 'NEVADA':
      return `SENAMHI ${color}: snowfall ${where}. Protect children and animals. Confirm: <link>`;
    case 'SUBE_NIVEL':
      return `SENAMHI RAISED to ${color}: warning ${delivery.nroAviso ?? ''} ${where}. Take extreme care. Confirm: <link>`;
    default:
      return `SENAMHI ${color}: warning ${delivery.nroAviso ?? ''} ${where}. Follow your local authorities. Confirm: <link>`;
  }
}

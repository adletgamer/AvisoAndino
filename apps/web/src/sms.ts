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

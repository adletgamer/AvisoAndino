import { describe, expect, it } from 'vitest';
import { confirmRequestSchema, replayRequestSchema, subscriberRequestSchema } from '../src/schemas.js';
import { maskPhone } from '../src/privacy.js';

describe('contratos de API.md', () => {
  it('acepta un alta válida y aplica defaults', () => {
    const result = subscriberRequestSchema.parse({
      channel: 'SMS',
      phone: '+51912345678',
      location: { lat: -15.984578, lon: -70.503961, codMod: '0226993' },
      consent: true,
      website: '',
    });
    expect(result).toMatchObject({ minLevel: 3, role: 'FAMILIA' });
  });

  it('rechaza teléfono, consentimiento, coordenadas y honeypot inválidos', () => {
    expect(subscriberRequestSchema.safeParse({
      channel: 'SMS',
      phone: '+511234',
      location: { lat: 40, lon: -70 },
      consent: false,
      website: 'bot',
    }).success).toBe(false);
  });

  it('valida confirmación y replay estrictos', () => {
    expect(confirmRequestSchema.safeParse({ code: 'K7P2QX' }).success).toBe(true);
    expect(confirmRequestSchema.safeParse({ code: 'ILOU12' }).success).toBe(false);
    expect(replayRequestSchema.safeParse({ year: 2026, nroAviso: 230, mapa: 1 }).success).toBe(true);
    expect(replayRequestSchema.safeParse({ year: 2027, nroAviso: 0, extra: true }).success).toBe(false);
  });

  it('maskPhone nunca devuelve el número completo', () => {
    const phone = '+51912345678';
    const masked = maskPhone(phone);
    expect(masked).toBe('+51 9•••••678');
    expect(masked).not.toContain(phone);
    expect(JSON.stringify({ phone: masked })).not.toMatch(/\+519\d{8}/);
  });
});

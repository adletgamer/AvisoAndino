import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickDelivery } from '../src/components/ReplayDemo';
import { DICTIONARIES, I18nProvider } from '../src/i18n';
import { Panel } from '../src/pages/Panel';
import { translateSms } from '../src/sms';
import type { ReplayDelivery } from '../src/api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = { channel: 'SIMULATED', status: 'SENT', sentAt: '2026-09-29T15:00:05Z', confirmedAt: null, phone: 'SIMULADO', latencyFromReplayStartSec: 5, text: 'x' } as const;

describe('demo', () => {
  it('prefiere el SMS del visitante, luego el del colegio demo', () => {
    const seed = { ...base, mine: false, demoSeed: true, text: 'seed' } as ReplayDelivery;
    const mine = { ...base, mine: true, demoSeed: false, text: 'mine' } as ReplayDelivery;
    expect(pickDelivery([seed, mine])?.text).toBe('mine');
    expect(pickDelivery([seed])?.text).toBe('seed');
    expect(pickDelivery([{ ...seed, sentAt: null }])).toBeUndefined();
  });

  it('caption EN desde los campos reales de la delivery', () => {
    expect(translateSms({ template: 'HELADA_SIN_TMIN', color: 'NARANJA', fechas: '13/06', lugar: 'HUAMBO' })).toBe(
      'SENAMHI ORANGE: frost 13/06 in HUAMBO. Keep children and animals warm. Confirm: <link>',
    );
  });

  it('el SMS se confirma por enlace; "responder 1" solo se describe para Telegram', () => {
    for (const t of Object.values(DICTIONARIES)) {
      expect(t.register.smsNote).not.toMatch(/respond|reply/i);
      expect(t.register.telegramNote).toMatch(/1/);
    }
  });

  it('panel vacío muestra estados vacíos y no inventa números', async () => {
    const empty = {
      generatedAt: '2026-09-29T15:00:00Z',
      subscribers: { active: 0, simulationOnly: 0, sms: 0 },
      production: { sent: 0, confirmed: 0, confirmedPct: null, delivered: 0, failed: 0, latency: { publicationToSendMin: null, detectToSendSec: null }, recent: [] },
      replay: { runsShown: 0, sent: 0, confirmed: 0, confirmedPct: null, realSmsSent: 0, latency: { replayStartToSendSec: null }, runs: [], recent: [] },
      warning: null,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => empty }));
    render(<I18nProvider initial="es"><Panel /></I18nProvider>);
    await waitFor(() => expect(screen.getByText(DICTIONARIES.es.panel.productionEmpty)).toBeTruthy());
    expect(screen.getByText(DICTIONARIES.es.panel.replayEmpty)).toBeTruthy();
    expect(screen.getByText(DICTIONARIES.es.panel.noWarning)).toBeTruthy();
    expect(screen.getByTestId('replay-sent').textContent).toContain('0');
  });
});

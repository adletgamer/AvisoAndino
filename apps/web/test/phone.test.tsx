import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Phone } from '../src/components/Phone';
import { I18nProvider } from '../src/i18n';
import { sampleWarningSms } from '../src/sms';

afterEach(cleanup);

describe('Phone / SMS', () => {
  it('usa la plantilla real HELADA en español GSM-7 (≤160, sin tildes)', () => {
    const sms = sampleWarningSms();
    expect(sms.startsWith('SENAMHI NARANJA: heladas')).toBe(true);
    expect([...sms].length).toBeLessThanOrEqual(160);
    expect(/[áéíóúñ]/i.test(sms)).toBe(false);
  });

  it('muestra el SMS en español con lang="es" y el caption solo en EN', () => {
    const sms = sampleWarningSms();
    const es = render(<I18nProvider initial="es"><Phone sms={sms} caption="EN caption" animate={false} /></I18nProvider>);
    expect(screen.getByText(sms).closest('[lang]')?.getAttribute('lang')).toBe('es');
    expect(screen.queryByText('EN caption', { exact: false })).toBeNull();
    es.unmount();
    render(<I18nProvider initial="en"><Phone sms={sms} caption="EN caption" animate={false} /></I18nProvider>);
    expect(screen.getByText(sms).closest('[lang]')?.getAttribute('lang')).toBe('es');
    expect(screen.getByText('EN caption', { exact: false })).toBeTruthy();
  });
});

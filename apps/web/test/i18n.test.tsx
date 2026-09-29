import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { DICTIONARIES, STORAGE_KEY, detectLocale } from '../src/i18n';
import { sampleWarningSms } from '../src/sms';

function goTo(url: string) {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  // jsdom no implementa WebGL: el hero debe caer al fallback estático sin cargar three.js.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.localStorage.clear();
  document.documentElement.lang = 'es';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    status: 'MVP_READY', ingestEnabled: false, smsEnabled: false, generatedAt: '2026-09-29T01:34:15.124Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  goTo('/');
});

describe('detectLocale', () => {
  it('usa español por defecto', () => {
    expect(detectLocale('', null)).toBe('es');
  });
  it('respeta ?lang=en por encima de localStorage', () => {
    expect(detectLocale('?lang=en', { getItem: () => 'es' })).toBe('en');
  });
  it('usa el valor guardado y descarta valores inválidos', () => {
    expect(detectLocale('', { getItem: () => 'en' })).toBe('en');
    expect(detectLocale('?lang=fr', { getItem: () => 'xx' })).toBe('es');
  });
});

describe('diccionarios', () => {
  it('EN tiene exactamente las mismas claves que ES', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    expect(keys(DICTIONARIES.en).sort()).toEqual(keys(DICTIONARIES.es).sort());
  });
});

describe('toggle ES | EN', () => {
  it('cambia el texto, <html lang> y lo persiste', async () => {
    goTo('/');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DICTIONARIES.es.hero.title);
    expect(document.documentElement.lang).toBe('es');

    const toggle = screen.getByRole('button', { name: DICTIONARIES.es.nav.toggleLabel });
    await act(async () => { fireEvent.click(toggle); });

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DICTIONARIES.en.hero.title);
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en');
    expect(screen.getByRole('button', { name: DICTIONARIES.en.nav.toggleLabel })).toBeTruthy();
  });

  it('funciona con teclado (es un <button> nativo enfocable)', () => {
    render(<App />);
    const toggle = screen.getByTestId('lang-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
  });

  it('recuerda el idioma guardado al volver a cargar', () => {
    window.localStorage.setItem(STORAGE_KEY, 'en');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DICTIONARIES.en.hero.title);
  });

  it('honra ?lang=en', () => {
    goTo('/?lang=en');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DICTIONARIES.en.hero.title);
    expect(document.documentElement.lang).toBe('en');
  });

  it('en EN el SMS sigue en español y se añade la traducción', () => {
    goTo('/?lang=en');
    const { container } = render(<App />);
    expect(container.textContent).toContain(DICTIONARIES.en.phone.captionLabel);
    expect(container.textContent).toContain(DICTIONARIES.en.phone.caption);
    expect(container.querySelector('.hero-canvas')?.closest('.mode-static')).toBeTruthy();
    expect(sampleWarningSms()).toMatch(/^SENAMHI NARANJA: heladas/);
  });

  it('traduce también la página de registro', async () => {
    goTo('/registro');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DICTIONARIES.es.register.title);
    await act(async () => { fireEvent.click(screen.getByTestId('lang-toggle')); });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DICTIONARIES.en.register.title);
    expect(screen.getByText(DICTIONARIES.en.register.consent)).toBeTruthy();
  });
});

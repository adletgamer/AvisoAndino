import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Link } from '../router';

export function LanguageToggle() {
  const { locale, toggle, t } = useI18n();
  return (
    <button type="button" className="lang-toggle" onClick={toggle} aria-label={t.nav.toggleLabel} data-testid="lang-toggle">
      <span aria-hidden="true" className={locale === 'es' ? 'is-active' : ''}>ES</span>
      <span aria-hidden="true" className="sep">|</span>
      <span aria-hidden="true" className={locale === 'en' ? 'is-active' : ''}>EN</span>
    </button>
  );
}

export function Nav() {
  const { t } = useI18n();
  return (
    <nav className="site-nav" aria-label={t.nav.label}>
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">▲</span> Aviso Andino
      </Link>
      <div className="nav-links">
        <Link href="/#como-funciona">{t.nav.how}</Link>
        <Link href="/#demo">{t.nav.demo}</Link>
        <Link href="/panel">{t.nav.panel}</Link>
        <Link className="nav-cta" href="/registro">{t.nav.register}</Link>
        <LanguageToggle />
      </div>
    </nav>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <strong>Aviso Andino</strong>
      <p>{t.footer.data}</p>
      <a href="https://github.com/adletgamer/AvisoAndino" rel="noreferrer">{t.footer.repo}</a>
    </footer>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <a className="skip-link" href="#main">{t.nav.skip}</a>
      <header className="page-header"><Nav /></header>
      <main id="main" className="page-main">{children}</main>
      <Footer />
    </>
  );
}

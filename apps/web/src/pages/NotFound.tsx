import { PageShell } from '../components/Layout';
import { useI18n } from '../i18n';
import { Link } from '../router';

export function NotFound() {
  const { t } = useI18n();
  return (
    <PageShell>
      <section className="confirm-page">
        <h1>{t.notFound.title}</h1>
        <Link className="button" href="/">{t.notFound.back}</Link>
      </section>
    </PageShell>
  );
}

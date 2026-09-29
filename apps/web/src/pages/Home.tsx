import { HeroVisual } from '../components/HeroVisual';
import { Footer, Nav } from '../components/Layout';
import { ReplayDemo } from '../components/ReplayDemo';
import { Reveal } from '../components/Reveal';
import { StatusWidget } from '../components/StatusWidget';
import { useI18n } from '../i18n';
import { Link } from '../router';

export function Home() {
  const { t } = useI18n();
  return (
    <>
      <a className="skip-link" href="#main">{t.nav.skip}</a>
      <header className="hero">
        <HeroVisual />
        <Nav />
        <div className="hero-content">
          <p className="eyebrow">{t.hero.eyebrow}</p>
          <h1>{t.hero.title}</h1>
          <p className="intro">{t.hero.intro}</p>
          <div className="hero-actions">
            <Link className="button" href="/registro">{t.hero.ctaPrimary}</Link>
            <a className="button ghost" href="#como-funciona">{t.hero.ctaSecondary}</a>
          </div>
        </div>
      </header>

      <main id="main">
        <Reveal as="section" id="como-funciona" aria-labelledby="como-title">
          <p className="eyebrow">{t.how.eyebrow}</p>
          <h2 id="como-title">{t.how.title}</h2>
          <div className="steps">
            {t.how.steps.map((step, index) => (
              <article key={step.title} style={{ transitionDelay: `${index * 90}ms` }}>
                <span>{index + 1}</span><h3>{step.title}</h3><p>{step.body}</p>
              </article>
            ))}
          </div>
        </Reveal>

        <Reveal as="section" id="demo" className="phone-section" aria-labelledby="phone-title">
          <div>
            <p className="eyebrow">{t.phone.eyebrow}</p>
            <h2 id="phone-title">{t.phone.title}</h2>
            <p>{t.phone.body}</p>
          </div>
          <ReplayDemo />
        </Reveal>

        <Reveal as="section" className="principle" aria-labelledby="principle-title">
          <div>
            <p className="eyebrow">{t.principle.eyebrow}</p>
            <h2 id="principle-title">{t.principle.title}</h2>
          </div>
          <p>{t.principle.body}</p>
        </Reveal>

        <Reveal as="section" id="estado">
          <StatusWidget />
        </Reveal>
      </main>
      <Footer />
    </>
  );
}

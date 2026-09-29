import { useEffect, useState } from 'react';
import { PageShell } from '../components/Layout';
import { useI18n } from '../i18n';

interface ConfirmAlert {
  title: string;
  color: string;
  level: number;
  fechas: string;
  lugar: string;
  tmin?: number;
  hazard: string;
  recommendations?: string[];
  officialUrl?: string;
}
interface ConfirmResponse { code: string; alreadyConfirmed: boolean; alert: ConfirmAlert }

const COLOR_CLASS: Record<string, string> = { AMARILLO: 'lvl-2', NARANJA: 'lvl-3', ROJO: 'lvl-4' };

export function Confirm({ code }: { code: string }) {
  const { t } = useI18n();
  const c = t.confirm;
  const [data, setData] = useState<ConfirmResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'done' | 'already' | 'error'>('loading');
  const api = import.meta.env.VITE_API_BASE ?? '/api';

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/confirm/${encodeURIComponent(code)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as ConfirmResponse;
        setData(body);
        setState(body.alreadyConfirmed ? 'already' : 'ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState('notfound');
      });
    return () => controller.abort();
  }, [api, code]);

  const confirm = async () => {
    try {
      const response = await fetch(`${api}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, channel: 'LINK' }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { firstTime?: boolean };
      setState(body.firstTime === false ? 'already' : 'done');
    } catch {
      setState('error');
    }
  };

  return (
    <PageShell>
      <section className="confirm-page" aria-live="polite">
        <p className="eyebrow">{c.eyebrow}</p>
        {state === 'loading' && <p>{c.loading}</p>}
        {state === 'notfound' && <p className="card">{c.notFound}</p>}
        {data && state !== 'notfound' && (
          <article className={`card alert-card ${COLOR_CLASS[data.alert.color] ?? ''}`}>
            <p className="alert-level"><span>{c.level}</span> <strong>{data.alert.color}</strong> · {data.alert.level}</p>
            <h1 lang="es">{data.alert.title}</h1>
            <dl>
              <div><dt>{c.dates}</dt><dd>{data.alert.fechas}</dd></div>
              <div><dt>{c.place}</dt><dd>{data.alert.lugar}</dd></div>
              {data.alert.tmin !== undefined && <div><dt>{c.tmin}</dt><dd>{data.alert.tmin} °C</dd></div>}
            </dl>
            {data.alert.recommendations?.length ? (
              <>
                <h2>{c.recommendations}</h2>
                <ul lang="es">{data.alert.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
              </>
            ) : null}
            {data.alert.officialUrl && <a href={data.alert.officialUrl} rel="noreferrer">{c.official}</a>}
            {state === 'ready' && <button type="button" className="button big" onClick={confirm}>{c.button}</button>}
            {state === 'done' && <p className="ok-msg">{c.thanks}</p>}
            {state === 'already' && <p className="ok-msg">{c.already}</p>}
            {state === 'error' && <p role="alert">{c.error}</p>}
          </article>
        )}
      </section>
    </PageShell>
  );
}

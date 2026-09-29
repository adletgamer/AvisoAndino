import { useCallback, useEffect, useState } from 'react';
import { API_BASE, limaTime, type DeliveryView, type PanelResponse, type Percentiles } from '../api';
import { PageShell } from '../components/Layout';
import { useI18n } from '../i18n';

const REFRESH_MS = 10_000;

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="stat" data-testid={testId}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function Panel() {
  const { t, locale } = useI18n();
  const p = t.panel;
  const [data, setData] = useState<PanelResponse | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/panel`);
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as PanelResponse);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const pct = (value: number | null) => (value === null ? '—' : `${value.toLocaleString(locale === 'es' ? 'es-PE' : 'en-US')} %`);
  const lat = (value: Percentiles | null, unit: string) =>
    value ? `p50 ${value.p50} ${unit} · p90 ${value.p90} ${unit} · n=${value.n}` : '—';

  const table = (rows: DeliveryView[], replay: boolean) => (
    <div className="table-wrap">
      <table className="deliveries">
        <thead>
          <tr>
            <th>{p.colTime}</th><th>{p.colPlace}</th><th>{p.colLevel}</th><th>{p.colChannel}</th>
            <th>{p.colPhone}</th><th>{p.colStatus}</th><th>{replay ? p.colLatencyReplay : p.colLatency}</th><th>{p.colConfirmed}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.createdAt}-${index}`}>
              <td>{limaTime(row.sentAt ?? row.createdAt, locale)}</td>
              <td>{row.lugar ?? '—'}</td>
              <td><span className={`lvl-badge lvl-${row.level ?? 0}`}>{row.color ?? '—'}</span></td>
              <td>{row.channel === 'SMS' && row.simulatedReason === 'NONE' ? p.channelRealSms : p.channels[row.channel] ?? row.channel}</td>
              <td className="mono">{row.phone === 'SIMULADO' ? p.simulatedPhone : row.phone}</td>
              <td>{p.statuses[row.status as keyof typeof p.statuses] ?? row.status}</td>
              <td>{replay ? (row.latencyFromReplayStartSec === null ? '—' : `${row.latencyFromReplayStartSec} s`) : '—'}</td>
              <td>{row.confirmedAt ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <PageShell>
      <section className="panel-page" data-testid="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">{p.eyebrow}</p>
            <h1>{p.title}</h1>
            <p className="panel-intro">{p.intro}</p>
          </div>
          <div className="panel-updated">
            <button type="button" className="button ghost small" onClick={() => void load()}>{p.refresh}</button>
            <small>{data ? `${p.updated}: ${limaTime(data.generatedAt, locale)}` : error ? p.error : p.loading}</small>
          </div>
        </div>

        {data && (
          <>
            <article className="card panel-card">
              <h2>{p.warningTitle}</h2>
              {data.warning ? (
                <div className={`warning-info lvl-${data.warning.maxLevel}`}>
                  <p className="warning-name">
                    <span className={`lvl-badge lvl-${data.warning.color === 'ROJO' ? 4 : data.warning.color === 'NARANJA' ? 3 : 2}`}>{data.warning.color ?? '—'}</span>{' '}
                    {p.avisoLabel} {data.warning.nroAviso}/{data.warning.year}: {data.warning.title}
                  </p>
                  <dl className="kv">
                    <div><dt>{p.issued}</dt><dd>{data.warning.fechaEmi}</dd></div>
                    <div><dt>{p.validity}</dt><dd>{limaTime(data.warning.fechIni, locale)} → {limaTime(data.warning.fechFin, locale)}</dd></div>
                    <div><dt>{p.maxLevel}</dt><dd>{data.warning.maxLevel}</dd></div>
                    <div><dt>{p.dataSource}</dt><dd>{data.warning.dataSource === 'snapshot' ? p.sourceSnapshot : p.sourceOfficial}</dd></div>
                    <div><dt>{p.simulatedNow}</dt><dd>{limaTime(data.warning.simulatedNow, locale)}</dd></div>
                  </dl>
                  <a href={data.warning.officialUrl} rel="noreferrer" target="_blank">{t.confirm.official} ↗</a>
                </div>
              ) : <p className="empty">{p.noWarning}</p>}
            </article>

            <article className="card panel-card" data-testid="panel-production">
              <h2>{p.productionTitle}</h2>
              <p className="section-note">{p.productionNote}</p>
              <dl className="stats">
                <Stat label={p.sent} value={String(data.production.sent)} />
                <Stat label={p.confirmed} value={String(data.production.confirmed)} />
                <Stat label={p.confirmedPct} value={pct(data.production.confirmedPct)} />
                <Stat label={p.latencyPublication} value={lat(data.production.latency.publicationToSendMin, 'min')} />
              </dl>
              {data.production.recent.length ? table(data.production.recent, false) : <p className="empty">{p.productionEmpty}</p>}
            </article>

            <article className="card panel-card replay-card" data-testid="panel-replay">
              <h2><span className="replay-badge">REPLAY</span> {p.replayTitle}</h2>
              <p className="section-note">{p.replayNote}</p>
              <dl className="stats">
                <Stat label={p.sent} value={String(data.replay.sent)} testId="replay-sent" />
                <Stat label={p.confirmed} value={String(data.replay.confirmed)} />
                <Stat label={p.confirmedPct} value={pct(data.replay.confirmedPct)} />
                <Stat label={p.latencyReplay} value={lat(data.replay.latency.replayStartToSendSec, 's')} />
                <Stat label={p.realSms} value={String(data.replay.realSmsSent)} />
              </dl>
              {data.replay.recent.length ? table(data.replay.recent, true) : <p className="empty">{p.replayEmpty}</p>}
              {data.replay.runs.length > 0 && (
                <details className="runs">
                  <summary>{p.runsTitle(data.replay.runsShown)}</summary>
                  <ul>
                    {data.replay.runs.map((run) => (
                      <li key={run.runId}>
                        <span className="mono">{run.runId}</span> · {limaTime(run.startedAt, locale)} · {p.avisoLabel} {run.nroAviso}/{run.year} ·{' '}
                        {run.mode === 'REAL_SMS' ? p.modeReal : p.modeSim} · {p.sent.toLowerCase()} {run.sent} · {p.confirmed.toLowerCase()} {run.confirmed}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>

            <p className="panel-foot">{p.subscribers(data.subscribers.active, data.subscribers.simulationOnly, data.subscribers.sms)}</p>
          </>
        )}
      </section>
    </PageShell>
  );
}

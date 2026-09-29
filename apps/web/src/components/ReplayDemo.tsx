import { useEffect, useRef, useState } from 'react';
import { API_BASE, limaTime, storedSubscriberId, type ReplayDelivery, type ReplayResponse } from '../api';
import { useI18n } from '../i18n';
import { Link } from '../router';
import { sampleWarningSms, translateSms } from '../sms';
import { Phone } from './Phone';

type State = 'idle' | 'starting' | 'running' | 'done' | 'empty' | 'limited' | 'failed';
const POLL_MS = 1500;
const MAX_WAIT_MS = 90_000;

/** Elige qué SMS mostrar: el del visitante, si no el del colegio demo, si no cualquiera ya enviado. */
export function pickDelivery(items: ReplayDelivery[]): ReplayDelivery | undefined {
  const sent = items.filter((item) => item.sentAt);
  return sent.find((item) => item.mine) ?? sent.find((item) => item.demoSeed) ?? sent[0];
}

export function ReplayDemo() {
  const { t, locale } = useI18n();
  const d = t.demo;
  const [state, setState] = useState<State>('idle');
  const [data, setData] = useState<ReplayResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const subscriberId = storedSubscriberId();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = async () => {
    window.clearTimeout(timer.current);
    setState('starting');
    setData(null);
    setElapsed(0);
    try {
      const response = await fetch(`${API_BASE}/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ year: 2026, nroAviso: 230, ...(subscriberId ? { subscriberId } : {}) }),
      });
      if (response.status === 429) return setState('limited');
      if (!response.ok) return setState('failed');
      const { runId } = (await response.json()) as { runId: string };
      setState('running');
      const began = Date.now();
      const poll = async () => {
        try {
          const query = subscriberId ? `?subscriberId=${subscriberId}` : '';
          const res = await fetch(`${API_BASE}/replay/${encodeURIComponent(runId)}/deliveries${query}`);
          if (res.ok) {
            const body = (await res.json()) as ReplayResponse;
            setData(body);
            const pending = body.items.some((item) => !item.sentAt && item.status !== 'FAILED');
            if (body.items.length > 0 && !pending && pickDelivery(body.items)) return setState('done');
          }
        } catch {
          // reintenta en el siguiente ciclo
        }
        setElapsed(Math.round((Date.now() - began) / 1000));
        if (Date.now() - began > MAX_WAIT_MS) return setState('empty');
        timer.current = window.setTimeout(poll, POLL_MS);
      };
      timer.current = window.setTimeout(poll, POLL_MS);
    } catch {
      setState('failed');
    }
  };

  const shown = data ? pickDelivery(data.items) : undefined;
  const visitorMissing = Boolean(subscriberId) && state === 'done' && !data?.items.some((item) => item.mine);
  const realSms = shown?.channel === 'SMS' && shown.simulatedReason === 'NONE';
  const busy = state === 'starting' || state === 'running';

  return (
    <div className="replay-demo" data-testid="replay-demo">
      {shown ? (
        <Phone
          sms={shown.text}
          animate={false}
          caption={translateSms(shown)}
          time={limaTime(shown.sentAt, locale, false)}
          note={realSms ? d.realNote(shown.phone) : d.simNote}
        >
          <dl className="replay-meta">
            <div><dt>{d.metaRun}</dt><dd>{d.replayLabel}</dd></div>
            <div><dt>{d.metaLatency}</dt><dd>{shown.latencyFromReplayStartSec ?? '—'} s</dd></div>
            <div><dt>{d.metaSimNow}</dt><dd>{limaTime(shown.simulatedNow ?? data?.meta.simulatedNow, locale)}</dd></div>
            <div><dt>{d.metaTarget}</dt><dd>{shown.mine ? d.targetMine : shown.demoSeed ? d.targetSeed : shown.lugar}</dd></div>
          </dl>
          {shown.confirmCode && (
            <Link className="button small" href={`/c/${shown.confirmCode}`}>{t.confirm.button} →</Link>
          )}
        </Phone>
      ) : (
        <Phone sms={sampleWarningSms()} caption={t.phone.caption} animate={false} pending={busy}>
          <p className="replay-status" aria-live="polite">{busy ? d.running(elapsed) : d.sampleNote}</p>
        </Phone>
      )}
      <div className="replay-actions">
        <button type="button" className="button" onClick={start} disabled={busy} data-testid="replay-button">
          {busy ? d.buttonBusy : state === 'idle' ? d.button : d.buttonAgain}
        </button>
        <p className="replay-hint" aria-live="polite">
          {state === 'limited' && d.limited}
          {state === 'failed' && d.failed}
          {state === 'empty' && d.empty}
          {visitorMissing && d.visitorMissing}
          {state === 'idle' && (subscriberId ? d.hintRegistered : d.hint)}
        </p>
        <Link className="replay-panel-link" href="/panel">{d.panelLink} →</Link>
      </div>
    </div>
  );
}

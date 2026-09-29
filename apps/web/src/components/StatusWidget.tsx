import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

interface ServiceStatus {
  status: string;
  ingestEnabled: boolean;
  smsEnabled: boolean;
  generatedAt: string;
}

export function StatusWidget() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.VITE_API_BASE ?? '/api'}/status`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setStatus(await response.json() as ServiceStatus);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStatusError(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="status-card" aria-live="polite">
      <div>
        <p className="eyebrow">{t.status.eyebrow}</p>
        <h2>{t.status.title}</h2>
      </div>
      {status && (
        <div>
          <dl>
            <div><dt>{t.status.api}</dt><dd className="ok">{t.status.available}</dd></div>
            <div><dt>{t.status.ingest}</dt><dd>{status.ingestEnabled ? t.status.active : t.status.paused}</dd></div>
            <div><dt>{t.status.sms}</dt><dd>{status.smsEnabled ? t.status.smsActive : t.status.safeMode}</dd></div>
          </dl>
          {status.generatedAt && (
            <p className="status-time">
              {t.status.updated}: {new Date(status.generatedAt).toLocaleTimeString(locale === 'es' ? 'es-PE' : 'en-US', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}
      {!status && !statusError && <p>{t.status.checking}</p>}
      {statusError && <p>{t.status.error}</p>}
    </div>
  );
}

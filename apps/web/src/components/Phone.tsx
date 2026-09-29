import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

/** Teléfono simulado. El SMS se muestra tal cual (español, GSM-7); en EN se añade una traducción aparte. */
export function Phone({ sms, caption, animate = true }: { sms: string; caption?: string; animate?: boolean }) {
  const { t, locale } = useI18n();
  const [run, setRun] = useState(0);
  const [arrived, setArrived] = useState(!animate);

  useEffect(() => {
    if (!animate) return;
    setArrived(false);
    const timer = window.setTimeout(() => setArrived(true), 900);
    return () => window.clearTimeout(timer);
  }, [animate, run]);

  return (
    <figure className="phone-wrap">
      <div className="phone" role="img" aria-label={t.phone.deviceLabel}>
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-screen">
          <div className="phone-status" aria-hidden="true"><span>9:41</span><span>▂▄▆ 4G</span></div>
          <p className="phone-sender">{t.phone.sender}</p>
          {!arrived && <div className="typing" aria-hidden="true"><i /><i /><i /></div>}
          {arrived && (
            <div key={run} className="sms-bubble" lang="es">
              <p>{sms}</p>
              <time>{t.phone.now}</time>
            </div>
          )}
        </div>
      </div>
      <figcaption>
        <p className="sms-counter">{t.phone.counter([...sms].length)}</p>
        {locale === 'en' && caption && (
          <p className="sms-caption" lang="en"><strong>{t.phone.captionLabel}</strong> {caption}</p>
        )}
        <p className="sms-sim">{t.phone.simulated}</p>
        {animate && (
          <button type="button" className="button ghost small" onClick={() => setRun((n) => n + 1)}>{t.phone.replay}</button>
        )}
      </figcaption>
    </figure>
  );
}

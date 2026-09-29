import { useState, type FormEvent } from 'react';
import { PageShell } from '../components/Layout';
import { Phone } from '../components/Phone';
import { useI18n } from '../i18n';
import { welcomeSms } from '../sms';

type Channel = 'SIMULATED' | 'TELEGRAM' | 'SMS';
type Hazard = 'HELADA' | 'FRIAJE' | 'LLUVIA' | 'NEVADA';
const HAZARDS: Hazard[] = ['HELADA', 'FRIAJE', 'LLUVIA', 'NEVADA'];
const PHONE_RE = /^\+519\d{8}$/;

export function Register() {
  const { t } = useI18n();
  const r = t.register;
  const [channel, setChannel] = useState<Channel>('SIMULATED');
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [lat, setLat] = useState('-14.07');
  const [lon, setLon] = useState('-70.43');
  const [minLevel, setMinLevel] = useState<2 | 3>(3);
  const [hazards, setHazards] = useState<Hazard[]>(HAZARDS);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'unavailable' | 'failed'>('idle');

  const useMyLocation = () => navigator.geolocation?.getCurrentPosition((p) => {
    setLat(p.coords.latitude.toFixed(4));
    setLon(p.coords.longitude.toFixed(4));
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: string[] = [];
    const latN = Number(lat), lonN = Number(lon);
    if (channel === 'SMS' && !PHONE_RE.test(phone)) nextErrors.push(r.phoneError);
    if (!(latN >= -18.4 && latN <= 0.1 && lonN >= -81.4 && lonN <= -68.6)) nextErrors.push(r.locationError);
    if (!consent) nextErrors.push(r.consentError);
    setErrors(nextErrors);
    if (nextErrors.length) return;
    setState('sending');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE ?? '/api'}/subscribers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel,
          ...(channel === 'SMS' ? { phone } : {}),
          location: { lat: latN, lon: lonN, ...(place ? { centroPoblado: place.slice(0, 80) } : {}) },
          minLevel,
          hazards,
          consent: true,
          website,
        }),
      });
      if (response.ok) setState('ok');
      else if ([404, 501, 503].includes(response.status)) setState('unavailable');
      else setState('failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <PageShell>
      <section className="form-page">
        <div className="form-intro">
          <p className="eyebrow">{r.eyebrow}</p>
          <h1>{r.title}</h1>
          <p>{r.intro}</p>
        </div>
        <div className="form-grid">
          <form className="card form" onSubmit={submit} noValidate>
            <fieldset>
              <legend>{r.channel}</legend>
              {(['SIMULATED', 'TELEGRAM', 'SMS'] as Channel[]).map((value) => (
                <label key={value} className="choice">
                  <input type="radio" name="channel" value={value} checked={channel === value} onChange={() => setChannel(value)} />
                  {r.channels[value]}
                </label>
              ))}
            </fieldset>
            {channel === 'SMS' && (
              <label className="field">
                <span>{r.phone}</span>
                <input type="tel" inputMode="tel" autoComplete="tel" placeholder="+519XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value.trim())} aria-describedby="phone-hint" />
                <small id="phone-hint">{r.phoneHint}. {r.smsNote}</small>
              </label>
            )}
            <fieldset>
              <legend>{r.location}</legend>
              <label className="field"><span>{r.place}</span>
                <input value={place} maxLength={80} onChange={(e) => setPlace(e.target.value)} />
              </label>
              <div className="row">
                <label className="field"><span>{r.lat}</span><input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></label>
                <label className="field"><span>{r.lon}</span><input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} /></label>
              </div>
              <button type="button" className="button ghost small" onClick={useMyLocation}>{r.useLocation}</button>
            </fieldset>
            <fieldset>
              <legend>{r.level}</legend>
              {([3, 2] as const).map((value) => (
                <label key={value} className="choice">
                  <input type="radio" name="level" checked={minLevel === value} onChange={() => setMinLevel(value)} />
                  {r.levels[value]}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>{r.hazards}</legend>
              <div className="chips">
                {HAZARDS.map((hazard) => (
                  <label key={hazard} className="chip">
                    <input type="checkbox" checked={hazards.includes(hazard)}
                      onChange={(e) => setHazards((cur) => (e.target.checked ? [...cur, hazard] : cur.filter((h) => h !== hazard)))} />
                    {r.hazardNames[hazard]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="hp" aria-hidden="true">website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
            <label className="choice consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              {r.consent}
            </label>
            {errors.length > 0 && (
              <ul className="form-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            )}
            <button className="button" type="submit" disabled={state === 'sending'}>{state === 'sending' ? r.sending : r.submit}</button>
            <p className="form-result" aria-live="polite">
              {state === 'ok' && r.success}
              {state === 'unavailable' && r.unavailable}
              {state === 'failed' && r.failed}
            </p>
          </form>
          <aside aria-label={r.preview}>
            <p className="eyebrow">{r.preview}</p>
            <Phone sms={welcomeSms(place)} animate={false} />
          </aside>
        </div>
      </section>
    </PageShell>
  );
}

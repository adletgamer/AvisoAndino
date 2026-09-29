import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

interface ServiceStatus {
  status: string;
  ingestEnabled: boolean;
  smsEnabled: boolean;
  generatedAt: string;
}

function App() {
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
    <>
      <header className="hero">
        <nav aria-label="Navegación principal">
          <a className="brand" href="/">Aviso Andino</a>
          <a href="#estado">Estado</a>
        </nav>
        <div className="hero-content">
          <p className="eyebrow">Alertas para colegios rurales del Perú</p>
          <h1>El aviso oficial, claro y directo al celular</h1>
          <p className="intro">
            Convertimos avisos de SENAMHI e INDECI en mensajes breves con el nivel,
            los días y una recomendación práctica.
          </p>
          <a className="button" href="#como-funciona">Conoce cómo funciona</a>
        </div>
      </header>

      <main>
        <section id="como-funciona" aria-labelledby="como-title">
          <p className="eyebrow">Cómo funciona</p>
          <h2 id="como-title">De un polígono oficial a un mensaje útil</h2>
          <div className="steps">
            <article><span>1</span><h3>Revisamos</h3><p>Consultamos fuentes oficiales cada 15 minutos.</p></article>
            <article><span>2</span><h3>Verificamos</h3><p>Reglas deterministas comprueban ubicación, nivel y vigencia.</p></article>
            <article><span>3</span><h3>Avisamos</h3><p>Preparamos un SMS GSM-7 de hasta 160 caracteres.</p></article>
          </div>
        </section>

        <section className="principle" aria-labelledby="principle-title">
          <div>
            <p className="eyebrow">Principio de seguridad</p>
            <h2 id="principle-title">La IA no decide una alerta</h2>
          </div>
          <p>
            Quién recibe un aviso, cuándo y con qué nivel se determina únicamente
            con datos oficiales y código probado. La reescritura con IA está apagada por defecto.
          </p>
        </section>

        <section id="estado" className="status-card" aria-live="polite">
          <div>
            <p className="eyebrow">Estado del servicio</p>
            <h2>MVP preparado para despliegue</h2>
          </div>
          {status && (
            <dl>
              <div><dt>API</dt><dd className="ok">Disponible</dd></div>
              <div><dt>Ingesta real</dt><dd>{status.ingestEnabled ? 'Activa' : 'Pausada'}</dd></div>
              <div><dt>SMS real</dt><dd>{status.smsEnabled ? 'Activo' : 'Modo seguro'}</dd></div>
            </dl>
          )}
          {!status && !statusError && <p>Comprobando la API…</p>}
          {statusError && <p>La API se habilitará al desplegar la stack.</p>}
        </section>
      </main>

      <footer>
        <strong>Aviso Andino</strong>
        <p>Datos: SENAMHI e INDECI GeoSINPAD · Proyecto de hackathon, no oficial.</p>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

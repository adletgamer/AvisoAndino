import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

/** Kill-switch de build: VITE_HERO_3D=false desactiva la escena 3D. */
const HERO_3D_ENABLED = import.meta.env.VITE_HERO_3D !== 'false';

interface NetworkInformationLike { saveData?: boolean; effectiveType?: string }

export function canUse3D(win: Window = window): boolean {
  if (!HERO_3D_ENABLED) return false;
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const connection = (win.navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType && /(^|-)(2g|3g)$/.test(connection.effectiveType)) return false;
  try {
    const probe = win.document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Fallback estático (SVG low-poly) que también se ve mientras carga el chunk 3D. */
function StaticMountains() {
  return (
    <svg className="hero-static" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="mtn-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a7552" /><stop offset="1" stopColor="#1f5a43" /></linearGradient>
        <linearGradient id="mtn-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2e6b52" /><stop offset="1" stopColor="#0f2d22" /></linearGradient>
      </defs>
      <polygon fill="url(#mtn-a)" opacity=".75" points="0,420 0,260 140,170 250,230 390,110 520,210 640,90 780,200 900,130 1040,220 1200,150 1200,420" />
      <polygon fill="#f3efe4" opacity=".85" points="390,110 420,140 402,150 372,128" />
      <polygon fill="#f3efe4" opacity=".85" points="640,90 675,125 650,132 615,118" />
      <polygon fill="url(#mtn-b)" points="0,420 0,330 180,250 330,310 470,230 620,320 760,240 920,300 1060,250 1200,300 1200,420" />
      <circle cx="652" cy="96" r="7" fill="#f59e0b" />
      <circle className="svg-pulse" cx="652" cy="96" r="16" fill="none" stroke="#f8b93c" strokeWidth="3" />
    </svg>
  );
}

export function HeroVisual() {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<'static' | 'loading' | '3d'>('static');

  useEffect(() => {
    if (!canUse3D()) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    // Tras el primer pintado: no compite con el contenido inicial.
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 1500 });
      else setTimeout(cb, 300);
    };
    requestAnimationFrame(() => idle(() => {
      if (cancelled) return;
      setMode('loading');
      import('./heroScene')
        .then(({ mountHeroScene }) => {
          if (cancelled || !canvasRef.current) return;
          dispose = mountHeroScene(canvasRef.current);
          setMode('3d');
        })
        .catch(() => setMode('static'));
    }));
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div className={`hero-visual mode-${mode}`} role="img" aria-label={t.hero.sceneLabel}>
      <StaticMountains />
      <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />
    </div>
  );
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// TODO(prompt 04/05): rutas / , /registro, /c/:code, /b/:code, /panel, /replay
function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 640, margin: '0 auto' }}>
      <h1>Aviso Andino</h1>
      <p>Avisos oficiales de SENAMHI, en un SMS claro, para tu colegio. Pronto.</p>
      <p><small>Solo avisos oficiales. La IA no decide.</small></p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { I18nProvider, type Locale } from './i18n';
import { Confirm } from './pages/Confirm';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { Panel } from './pages/Panel';
import { Register } from './pages/Register';
import { usePathname } from './router';

function Routes() {
  const path = usePathname().replace(/\/+$/, '') || '/';
  if (path === '/') return <Home />;
  if (path === '/registro') return <Register />;
  if (path === '/panel') return <Panel />;
  const confirm = /^\/c\/([0-9A-Za-z]{6})$/.exec(path);
  if (confirm) return <Confirm code={confirm[1]!.toUpperCase()} />;
  return <NotFound />;
}

export function App({ initialLocale }: { initialLocale?: Locale }) {
  return (
    <I18nProvider initial={initialLocale}>
      <Routes />
    </I18nProvider>
  );
}

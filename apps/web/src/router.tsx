import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const NAVIGATE_EVENT = 'aviso:navigate';

export function navigate(to: string): void {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  window.scrollTo({ top: 0 });
}

export function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return path;
}

/** Enlace interno con pushState; conserva ?lang= si está presente. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (href.startsWith('#')) return;
    event.preventDefault();
    const [pathPart, hash] = href.split('#');
    navigate(pathPart || '/');
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  };
  return <a href={href} onClick={handle} {...rest} />;
}

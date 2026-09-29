import { useEffect, useRef, type ReactNode } from 'react';

/** Entrada al hacer scroll (IntersectionObserver + CSS). Sin JS o con reduced-motion se ve directo. */
export function Reveal({ children, as: Tag = 'div', className = '', ...rest }: {
  children: ReactNode;
  as?: 'div' | 'section' | 'article';
  className?: string;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      node.classList.add('is-visible');
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${className}`} {...rest}>{children}</Tag>;
}

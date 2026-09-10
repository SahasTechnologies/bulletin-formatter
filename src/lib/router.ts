/**
 * A 20-line path router — enough for the app's single `/guide` route without
 * pulling in react-router. Vite's dev server and `vite preview` both fall back
 * to index.html for unknown paths, so `/guide` deep-links fine.
 */
import { useEffect, useState } from 'react';

/** Normalised current path: no trailing slash, always starts with "/". */
export function currentPath(): string {
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** Push a new path and notify subscribers (popstate fires for back/forward). */
export function navigate(path: string): void {
  const next = path.startsWith('/') ? path : `/${path}`;
  if (currentPath() !== next) window.history.pushState({}, '', next);
  // pushState alone does not fire popstate, so announce it ourselves.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Subscribe to the current path. */
export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return path;
}

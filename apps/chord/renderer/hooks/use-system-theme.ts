// The shared stylesheet (`@lumacast/ui/theme.css`) switches to its dark
// palette on `[data-theme="dark"]`, not on `prefers-color-scheme` directly —
// Chord has no in-app theme toggle, so this hook is the only thing that ever
// sets it, mirroring the OS preference (and its live changes) onto the
// document root.
import { useEffect } from 'react';

export function useSystemThemeAttribute(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const root = window.document.documentElement;
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    function apply(matches: boolean) {
      root.setAttribute('data-theme', matches ? 'dark' : 'light');
    }

    apply(query.matches);
    function handleChange(event: MediaQueryListEvent) {
      apply(event.matches);
    }
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);
}

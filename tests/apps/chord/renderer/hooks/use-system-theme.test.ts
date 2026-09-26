import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSystemThemeAttribute } from '../../../../../apps/chord/renderer/hooks/use-system-theme';

type Listener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    dispatch(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);
  return mql;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('useSystemThemeAttribute', () => {
  it('sets data-theme to dark when the system prefers dark', () => {
    installMatchMedia(true);
    renderHook(() => useSystemThemeAttribute());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sets data-theme to light when the system prefers light', () => {
    installMatchMedia(false);
    renderHook(() => useSystemThemeAttribute());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('updates live as the system preference changes', () => {
    const mql = installMatchMedia(false);
    renderHook(() => useSystemThemeAttribute());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    mql.dispatch(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    mql.dispatch(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('stops listening on unmount', () => {
    const mql = installMatchMedia(false);
    const { unmount } = renderHook(() => useSystemThemeAttribute());
    unmount();
    mql.dispatch(true);
    // No listener left to react, so the attribute stays at its last value.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

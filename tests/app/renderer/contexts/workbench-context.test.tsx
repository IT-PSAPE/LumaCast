import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useWorkbench, WorkbenchProvider } from '../../../../app/renderer/contexts/workbench-context';

const LEGACY_KEY = 'lumacast.deck-browser-preferences.v1';
const SLIDE_MODE_KEY = 'lumacast.slide-browser-mode.v1';

function wrapper({ children }: { children: ReactNode }) {
  return <WorkbenchProvider>{children}</WorkbenchProvider>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('WorkbenchProvider slide browser preference', () => {
  it('migrates Grid/List from the legacy bundled preference and removes the obsolete key', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({
      slideBrowserMode: 'list',
      playlistBrowserMode: 'continuous',
    }));

    const { result } = renderHook(() => useWorkbench(), { wrapper });

    expect(result.current.state.slideBrowserMode).toBe('list');
    expect(window.localStorage.getItem(SLIDE_MODE_KEY)).toBe('list');
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('prefers an existing slide-only preference while cleaning up the legacy key', () => {
    window.localStorage.setItem(SLIDE_MODE_KEY, 'list');
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({
      slideBrowserMode: 'grid',
      playlistBrowserMode: 'current',
    }));

    const { result } = renderHook(() => useWorkbench(), { wrapper });

    expect(result.current.state.slideBrowserMode).toBe('list');
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('persists only the selected Grid/List mode', () => {
    const { result } = renderHook(() => useWorkbench(), { wrapper });

    act(() => result.current.actions.setSlideBrowserMode('list'));

    expect(window.localStorage.getItem(SLIDE_MODE_KEY)).toBe('list');
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

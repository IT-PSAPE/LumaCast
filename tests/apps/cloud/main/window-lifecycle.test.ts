import { describe, expect, it, vi } from 'vitest';
import { createWindowLifecycle } from '../../../../apps/cloud/main/window-lifecycle';

function fakeWindow() {
  return { isDestroyed: vi.fn(() => false), show: vi.fn(), focus: vi.fn() };
}

describe('apps/cloud background window lifecycle', () => {
  it('keeps the process alive after the last window closes', () => {
    const lifecycle = createWindowLifecycle({ getWindow: () => null, openWindow: vi.fn(fakeWindow) });

    expect(() => lifecycle.onAllWindowsClosed()).not.toThrow();
  });

  it('reopens and focuses the main window on a second launch', () => {
    const state: { currentWindow: ReturnType<typeof fakeWindow> | null } = { currentWindow: null };
    const openWindow = vi.fn(() => {
      state.currentWindow = fakeWindow();
      return state.currentWindow;
    });
    const lifecycle = createWindowLifecycle({ getWindow: () => state.currentWindow, openWindow });

    lifecycle.onSecondInstance();

    expect(openWindow).toHaveBeenCalledOnce();
    expect(state.currentWindow?.show).toHaveBeenCalledOnce();
    expect(state.currentWindow?.focus).toHaveBeenCalledOnce();
  });

  it('recreates a closed window on application activation', () => {
    const state: { currentWindow: ReturnType<typeof fakeWindow> | null } = { currentWindow: null };
    const openWindow = vi.fn(() => {
      state.currentWindow = fakeWindow();
      return state.currentWindow;
    });
    const lifecycle = createWindowLifecycle({ getWindow: () => state.currentWindow, openWindow });

    lifecycle.onActivate();

    expect(openWindow).toHaveBeenCalledOnce();
  });

  it('shows and focuses an existing window on application activation', () => {
    const currentWindow = fakeWindow();
    const openWindow = vi.fn(fakeWindow);
    const lifecycle = createWindowLifecycle({ getWindow: () => currentWindow, openWindow });

    lifecycle.onActivate();

    expect(openWindow).not.toHaveBeenCalled();
    expect(currentWindow.show).toHaveBeenCalledOnce();
    expect(currentWindow.focus).toHaveBeenCalledOnce();
  });

  it('restores and focuses the window when a notification is clicked', () => {
    const state: { currentWindow: ReturnType<typeof fakeWindow> | null } = { currentWindow: null };
    const openWindow = vi.fn(() => {
      state.currentWindow = fakeWindow();
      return state.currentWindow;
    });
    const lifecycle = createWindowLifecycle({ getWindow: () => state.currentWindow, openWindow });

    lifecycle.showWindow();

    expect(openWindow).toHaveBeenCalledOnce();
    expect(state.currentWindow?.show).toHaveBeenCalledOnce();
    expect(state.currentWindow?.focus).toHaveBeenCalledOnce();
  });
});

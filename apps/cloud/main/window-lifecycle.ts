interface WindowLifecycleTarget {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
}

export interface WindowLifecycleOptions {
  getWindow: () => WindowLifecycleTarget | null;
  openWindow: () => WindowLifecycleTarget;
}

/** Keeps Cloud available after the last window closes and restores it on activation. */
export function createWindowLifecycle(options: WindowLifecycleOptions) {
  const getUsableWindow = (): WindowLifecycleTarget | null => {
    const window = options.getWindow();
    return window && !window.isDestroyed() ? window : null;
  };

  return {
    onAllWindowsClosed(): void {
      // The tray menu remains available, so closing the shell is not a quit action.
    },
    onActivate(): void {
      const window = getUsableWindow() ?? options.openWindow();
      window.show();
      window.focus();
    },
    onSecondInstance(): void {
      const window = getUsableWindow() ?? options.openWindow();
      window.show();
      window.focus();
    },
    showWindow(): void {
      const window = getUsableWindow() ?? options.openWindow();
      window.show();
      window.focus();
    },
  };
}

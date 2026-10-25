import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia, but renderer modules read the system
// colour preference during module initialization. Keep the shared test
// environment browser-shaped so tests that import those modules do not need
// an order-dependent, per-file polyfill.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom has no PointerEvent, so `fireEvent.pointerEnter(el, { pointerType })`
// would fall back to a plain Event and drop pointerType. Libraries such as
// Base UI gate hover behaviour on pointerType === 'mouse'.
if (typeof window !== 'undefined' && typeof window.PointerEvent !== 'function') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill,
  });
}

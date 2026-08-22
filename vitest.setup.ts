import '@testing-library/jest-dom';

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

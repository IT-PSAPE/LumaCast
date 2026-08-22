import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

class MockFontFaceSet {
  ready: Promise<void>;
  private resolveReadyPromise!: () => void;
  private listeners = new Set<() => void>();
  addCalls = 0;
  removeCalls = 0;

  constructor() {
    this.ready = Promise.resolve();
    this.resetReady();
  }

  resetReady(): void {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReadyPromise = resolve;
    });
  }

  resolveReady(): void {
    this.resolveReadyPromise();
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'loadingdone') {
      this.addCalls += 1;
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'loadingdone') {
      this.removeCalls += 1;
      this.listeners.delete(listener);
    }
  }

  emitLoadingDone(): void {
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

async function loadEpochProbe() {
  vi.resetModules();
  const { useFontAvailabilityEpoch } = await import('./use-font-availability-epoch');

  return function EpochProbe({ onEpoch: handleEpoch }: { onEpoch: (epoch: number) => void }) {
    const epoch = useFontAvailabilityEpoch();

    useEffect(() => {
      handleEpoch(epoch);
    }, [epoch, handleEpoch]);

    return null;
  };
}

describe('useFontAvailabilityEpoch', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(document as Document & Record<string, unknown>, 'fonts');
  });

  it('advances when the current document.fonts.ready promise resolves', async () => {
    const fonts = new MockFontFaceSet();
    const onEpoch = vi.fn();
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts,
    });

    const EpochProbe = await loadEpochProbe();
    render(<EpochProbe onEpoch={onEpoch} />);

    expect(onEpoch).toHaveBeenLastCalledWith(0);

    fonts.resolveReady();

    await waitFor(() => {
      expect(onEpoch).toHaveBeenLastCalledWith(1);
    });
  });

  it('advances once per new loading cycle when loadingdone publishes a new ready promise', async () => {
    const fonts = new MockFontFaceSet();
    const onEpoch = vi.fn();
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts,
    });

    const EpochProbe = await loadEpochProbe();
    render(<EpochProbe onEpoch={onEpoch} />);

    fonts.resolveReady();

    await waitFor(() => {
      expect(onEpoch).toHaveBeenLastCalledWith(1);
    });

    fonts.resetReady();
    fonts.emitLoadingDone();

    expect(onEpoch).toHaveBeenLastCalledWith(1);

    fonts.resolveReady();

    await waitFor(() => {
      expect(onEpoch).toHaveBeenLastCalledWith(2);
    });
  });

  it('shares one loadingdone listener across mounts and unsubscribes after the last consumer', async () => {
    const fonts = new MockFontFaceSet();
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts,
    });

    const EpochProbe = await loadEpochProbe();
    const first = render(<EpochProbe onEpoch={() => {}} />);
    const second = render(<EpochProbe onEpoch={() => {}} />);

    expect(fonts.addCalls).toBe(1);
    expect(fonts.listenerCount()).toBe(1);

    first.unmount();
    expect(fonts.removeCalls).toBe(0);
    expect(fonts.listenerCount()).toBe(1);

    second.unmount();
    expect(fonts.removeCalls).toBe(1);
    expect(fonts.listenerCount()).toBe(0);
  });

  it('does not advance again when a later mount sees the same settled ready promise', async () => {
    const fonts = new MockFontFaceSet();
    const firstEpochs: number[] = [];
    const secondEpochs: number[] = [];
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts,
    });

    const EpochProbe = await loadEpochProbe();
    const first = render(<EpochProbe onEpoch={(epoch) => { firstEpochs.push(epoch); }} />);
    fonts.resolveReady();

    await waitFor(() => {
      expect(firstEpochs.at(-1)).toBe(1);
    });

    first.unmount();

    render(<EpochProbe onEpoch={(epoch) => { secondEpochs.push(epoch); }} />);

    await waitFor(() => {
      expect(secondEpochs.at(-1)).toBe(1);
    });

    expect(secondEpochs).toEqual([1]);
  });
});

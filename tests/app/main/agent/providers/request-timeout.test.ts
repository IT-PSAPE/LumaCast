// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { withIdleTimeout, withRequestTimeout } from '../../../../../app/main/agent/providers/request-timeout';

describe('withRequestTimeout', () => {
  it('aborts the signal after the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const timeout = withRequestTimeout(undefined, 100);
      expect(timeout.didTimeout()).toBe(false);

      vi.advanceTimersByTime(100);

      expect(timeout.didTimeout()).toBe(true);
      expect(timeout.signal.aborted).toBe(true);
      expect(timeout.signal.reason).toBeInstanceOf(DOMException);
      expect((timeout.signal.reason as DOMException).name).toBe('TimeoutError');
      timeout.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards an input signal abort without reporting a timeout', () => {
    const controller = new AbortController();
    const timeout = withRequestTimeout(controller.signal, 60_000);

    controller.abort(new Error('user cancel'));

    expect(timeout.didTimeout()).toBe(false);
    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.signal.reason).toBeInstanceOf(Error);
    timeout.dispose();
  });

  it('cleans up the timer on dispose', () => {
    vi.useFakeTimers();
    try {
      const timeout = withRequestTimeout(undefined, 60_000);
      timeout.dispose();

      vi.advanceTimersByTime(60_000);

      expect(timeout.didTimeout()).toBe(false);
      expect(timeout.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('withIdleTimeout', () => {
  it('fires after idle period with no reset', () => {
    vi.useFakeTimers();
    try {
      const idle = withIdleTimeout(undefined, 100);
      expect(idle.didTimeout()).toBe(false);

      vi.advanceTimersByTime(100);

      expect(idle.didTimeout()).toBe(true);
      expect(idle.signal.aborted).toBe(true);
      expect((idle.signal.reason as DOMException).name).toBe('TimeoutError');
      idle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the idle deadline when reset is called', () => {
    vi.useFakeTimers();
    try {
      const idle = withIdleTimeout(undefined, 100);

      vi.advanceTimersByTime(80);
      expect(idle.didTimeout()).toBe(false);
      idle.reset();

      vi.advanceTimersByTime(80);
      expect(idle.didTimeout()).toBe(false);

      vi.advanceTimersByTime(20);
      expect(idle.didTimeout()).toBe(true);
      idle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-arm after the watchdog has fired', () => {
    vi.useFakeTimers();
    try {
      const idle = withIdleTimeout(undefined, 100);

      vi.advanceTimersByTime(100);
      expect(idle.didTimeout()).toBe(true);

      idle.reset();

      vi.advanceTimersByTime(100);
      expect(idle.signal.aborted).toBe(true);
      idle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards input signal abort without reporting a timeout', () => {
    const controller = new AbortController();
    const idle = withIdleTimeout(controller.signal, 60_000);

    controller.abort(new Error('caller cancel'));

    expect(idle.didTimeout()).toBe(false);
    expect(idle.signal.aborted).toBe(true);
    expect(idle.signal.reason).toBeInstanceOf(Error);
    idle.dispose();
  });

  it('cleans up the timer and input listener on dispose', () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const idle = withIdleTimeout(controller.signal, 60_000);
      idle.dispose();

      vi.advanceTimersByTime(60_000);

      expect(idle.didTimeout()).toBe(false);
      expect(idle.signal.aborted).toBe(false);

      controller.abort();
      expect(idle.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});


it('does not turn caller cancellation into an idle timeout', () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    const idle = withIdleTimeout(controller.signal, 100);
    controller.abort();
    vi.advanceTimersByTime(200);
    expect(idle.didTimeout()).toBe(false);
    idle.dispose();
    idle.reset();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

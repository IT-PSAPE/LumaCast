export interface RequestTimeout {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
}

export function withRequestTimeout(inputSignal: AbortSignal | undefined, timeoutMs: number): RequestTimeout {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromInput = () => controller.abort(inputSignal?.reason);
  if (inputSignal?.aborted) abortFromInput();
  else inputSignal?.addEventListener('abort', abortFromInput, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timeoutId);
      inputSignal?.removeEventListener('abort', abortFromInput);
    },
  };
}

/**
 * An idle watchdog bound to an input signal, for deadlines that must be
 * measured from the most recent activity rather than from request start.
 * Typically used around a long-lived streaming body: the caller re-arms it
 * with `reset()` each time data arrives, so a stream that stalls mid-body
 * (response headers received, then silence) is aborted instead of hanging
 * forever. An abort of `inputSignal` is forwarded to the returned signal but
 * is never reported as a timeout; once the watchdog has fired or the input
 * has aborted it stays latched, so `didTimeout` says "the body stalled".
 */
export interface IdleTimeout extends RequestTimeout {
  reset: () => void;
}

export function withIdleTimeout(inputSignal: AbortSignal | undefined, idleMs: number): IdleTimeout {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  let disposed = false;
  const abortFromInput = () => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    controller.abort(inputSignal?.reason);
  };
  if (inputSignal?.aborted) abortFromInput();
  else inputSignal?.addEventListener('abort', abortFromInput, { once: true });

  const arm = (): void => {
    // Latched once the watchdog has fired or the input signal has aborted: a
    // fired timer must stay a timeout and a forwarded abort must stay a
    // cancel, so nothing may re-arm afterwards.
    if (disposed || timedOut || controller.signal.aborted) return;
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException(`Stream produced no data for ${idleMs}ms`, 'TimeoutError'));
    }, idleMs);
  };
  arm();

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    reset: () => arm(),
    dispose: () => {
      disposed = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      inputSignal?.removeEventListener('abort', abortFromInput);
    },
  };
}

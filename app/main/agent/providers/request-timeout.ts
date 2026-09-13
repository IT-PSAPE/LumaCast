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

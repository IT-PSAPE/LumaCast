/** Coalesce bursts while keeping the first pending notification's deadline. */
export function createCoalescedNotifier(
  notify: () => void,
  delayMs = 75,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const fire = () => {
    timer = undefined;
    if (!disposed) notify();
  };

  return {
    schedule() {
      if (disposed || timer !== undefined) return;
      timer = setTimeout(fire, delayMs);
    },
    flush() {
      if (disposed || timer === undefined) return false;
      clearTimeout(timer);
      timer = undefined;
      notify();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

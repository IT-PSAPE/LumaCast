import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoalescedNotifier } from '../../../../apps/flux/main/coalesced-notifier';

describe('coalesced notification scheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces bursts, flushes early, and cancels pending work on dispose', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const scheduler = createCoalescedNotifier(notify, 75);

    for (let index = 0; index < 1000; index++) scheduler.schedule();
    vi.advanceTimersByTime(74);
    expect(notify).not.toHaveBeenCalled();
    scheduler.schedule();
    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    expect(scheduler.flush()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(scheduler.flush()).toBe(false);

    scheduler.schedule();
    scheduler.dispose();
    vi.advanceTimersByTime(75);
    scheduler.schedule();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

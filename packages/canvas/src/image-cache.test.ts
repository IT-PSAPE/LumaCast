import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// MAX_ESTIMATED_BYTES in the cache is 96MB. Every stub image below decodes to
// 32MB, so a fourth retained image is what pushes the cache over budget.
const IMAGE_BYTES = 4096 * 2048 * 4;
const BUDGET_BYTES = 96 * 1024 * 1024;

const SIZED = new Map<string, { width: number; height: number }>();
const DEFERRED = new Map<string, { promise: Promise<void>; resolve: () => void }>();
const REJECTED = new Set<string>();

function src(name: string): string {
  return srcSized(name, 4096, 2048);
}

function srcSized(name: string, width: number, height: number): string {
  const url = `http://media.test/${name}.png`;
  SIZED.set(url, { width, height });
  return url;
}

function deferDecode(url: string) {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  DEFERRED.set(url, { promise, resolve });
}

function rejectDecode(url: string) {
  REJECTED.add(url);
}

// jsdom never actually loads images, so stand in for the parts image-cache
// reads: decode timing and the decoded pixel dimensions it bills bytes against.
//
// Dimensions are tracked per element rather than per src, matching the browser:
// clearing `src` does not retroactively zero what an already-decoded element
// reports, so a decode that settles after eviction still hands back real
// numbers. That is the case the byte accounting has to survive.
const DECODED_SIZE = new WeakMap<HTMLImageElement, { width: number; height: number }>();

function stubImageElement() {
  const nativeSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;

  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get(this: HTMLImageElement) { return nativeSrc.get!.call(this); },
    set(this: HTMLImageElement, value: string) {
      const size = SIZED.get(value);
      if (size) DECODED_SIZE.set(this, size);
      nativeSrc.set!.call(this, value);
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get() { return false; },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get(this: HTMLImageElement) { return DECODED_SIZE.get(this)?.width ?? 0; },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get(this: HTMLImageElement) { return DECODED_SIZE.get(this)?.height ?? 0; },
  });
  HTMLImageElement.prototype.decode = function decode(this: HTMLImageElement) {
    if (REJECTED.has(this.src)) return Promise.reject(new Error('decode failed'));
    return DEFERRED.get(this.src)?.promise ?? Promise.resolve();
  };
}

// Flushes the microtask queue so pending `image.decode()` handlers — and the
// eviction pass they trigger — have run.
function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

async function makeCandidate(cache: CacheModule, url: string) {
  const handle = cache.retainImage(url);
  await flush();
  handle.release();
  return handle;
}

type CacheModule = typeof import('./image-cache');

async function loadCache(): Promise<CacheModule> {
  vi.resetModules();
  return import('./image-cache');
}

beforeEach(() => {
  SIZED.clear();
  DEFERRED.clear();
  REJECTED.clear();
  stubImageElement();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('image cache eviction', () => {
  it('never evicts an entry that a mounted consumer still holds', async () => {
    const cache = await loadCache();
    const urls = [src('a'), src('b'), src('c'), src('d'), src('e')];

    const handles = [];
    for (const url of urls) {
      handles.push(cache.retainImage(url));
      await flush();
    }

    // Well past the 96MB budget, but every entry is retained — the cache must
    // overshoot rather than clear an element Konva is painting by reference.
    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(urls.length * IMAGE_BYTES);
    for (const [index, url] of urls.entries()) {
      const entry = handles[index].entry;
      expect(entry, `${url} was evicted while retained`).not.toBeNull();
      expect(entry.status).toBe('loaded');
      expect(entry.image.src).toBe(url);
      expect(entry.image).toBe(handles[index].entry.image);
    }
  });

  it('evicts released entries once the budget is exceeded', async () => {
    const cache = await loadCache();
    const [a, b, c, d, live1, live2, live3] = [src('a'), src('b'), src('c'), src('d'), src('live-1'), src('live-2'), src('live-3')];

    for (const url of [a, b, c]) {
      await makeCandidate(cache, url);
    }

    expect(cache.getImageCacheStats()).toMatchObject({
      evictableCount: 3,
      evictableEstimatedBytes: BUDGET_BYTES,
    });

    for (const url of [live1, live2, live3]) {
      cache.retainImage(url);
      await flush();
    }

    await makeCandidate(cache, d);

    expect(cache.peekImageEntry(a)).toBeNull();
    for (const url of [b, c, d, live1, live2, live3]) expect(cache.peekImageEntry(url)).not.toBeNull();
    expect(cache.getImageCacheStats()).toMatchObject({
      evictableCount: 3,
      evictableEstimatedBytes: BUDGET_BYTES,
      totalEstimatedBytes: 6 * IMAGE_BYTES,
    });
  });

  it('stops billing bytes for an entry once it has been evicted', async () => {
    const cache = await loadCache();
    const slow = src('slow');
    deferDecode(slow);

    // Retained then released while its decode is still in flight — an
    // abandoned load, which eviction reclaims ahead of anything else.
    const slowHandle = cache.retainImage(slow);
    slowHandle.release();
    expect(slowHandle.entry.status).toBe('loading');

    for (let index = 0; index < 128; index += 1) {
      await makeCandidate(cache, srcSized(`tiny-${index}`, 1, 1));
    }

    expect(cache.peekImageEntry(slow)).toBeNull();
    const bytesAfterEviction = cache.getImageCacheStats().totalEstimatedBytes;

    // The abandoned decode settles late and still reports real dimensions.
    // Billing them now charges the budget for an entry the cache no longer
    // holds — bytes nothing can ever reclaim, permanently shrinking headroom.
    DEFERRED.get(slow)?.resolve();
    await flush();

    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(bytesAfterEviction);
    expect(bytesAfterEviction).toBe(128 * 4);
  });

  it('keeps a soft-pinned render entry until its retain handoff can commit', async () => {
    const cache = await loadCache();
    const [a, b, c, d, e] = [src('a'), src('b'), src('c'), src('d'), src('e')];

    await makeCandidate(cache, a);
    const handleB = await makeCandidate(cache, b);
    await makeCandidate(cache, c);
    const reservation = cache.reserveImageEntry(handleB.entry);

    await makeCandidate(cache, d);
    await makeCandidate(cache, e);

    expect(cache.peekImageEntry(a)).toBeNull();
    expect(reservation?.entry).toBe(handleB.entry);
    expect(cache.peekImageEntry(b)).toBe(handleB.entry);
  });

  it('never evicts a retained entry while it is still loading', async () => {
    const cache = await loadCache();
    const slow = src('slow');
    deferDecode(slow);

    const slowHandle = cache.retainImage(slow);
    expect(slowHandle.entry.status).toBe('loading');

    for (const url of [src('a'), src('b'), src('c'), src('d')]) {
      cache.retainImage(url);
      await flush();
    }

    expect(cache.peekImageEntry(slow)).toBe(slowHandle.entry);
    expect(slowHandle.entry.image.src).toBe(slow);
  });

  it('preserves least-recently-used ordering even when accesses share a millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const cache = await loadCache();
    const [a, b, c, d] = [src('a'), src('b'), src('c'), src('d')];

    await makeCandidate(cache, a);
    await makeCandidate(cache, b);
    await makeCandidate(cache, c);
    const refreshB = cache.retainImage(b);
    await flush();
    refreshB.release();
    await makeCandidate(cache, d);

    expect(cache.peekImageEntry(a)).toBeNull();
    expect(cache.peekImageEntry(b)).not.toBeNull();
  });

  it('keeps peekImageEntry render-pure until a reservation is requested', async () => {
    const cache = await loadCache();
    const handle = cache.retainImage(src('warm'));
    await flush();
    handle.release();

    const before = cache.getImageCacheStats();
    const firstPeek = cache.peekImageEntry(handle.entry.image.src);
    const secondPeek = cache.peekImageEntry(handle.entry.image.src);
    const after = cache.getImageCacheStats();

    expect(firstPeek).toBe(handle.entry);
    expect(secondPeek).toBe(handle.entry);
    expect(after).toBe(before);
    expect(after.evictableCount).toBe(1);
    expect(after.evictableEstimatedBytes).toBe(IMAGE_BYTES);
  });

  it('excludes reserved entries from eviction until the reservation releases', async () => {
    const cache = await loadCache();
    const [a, b, c, d, e] = [src('a'), src('b'), src('c'), src('d'), src('e')];

    await makeCandidate(cache, a);
    const handleB = await makeCandidate(cache, b);
    await makeCandidate(cache, c);
    const reservation = cache.reserveImageEntry(handleB.entry);

    await makeCandidate(cache, d);
    await makeCandidate(cache, e);

    expect(cache.peekImageEntry(a)).toBeNull();
    expect(cache.peekImageEntry(b)).toBe(handleB.entry);
    expect(cache.getImageCacheStats().evictableCount).toBe(3);

    reservation?.release();

    expect(cache.peekImageEntry(b)).toBe(handleB.entry);
    expect(cache.peekImageEntry(c)).toBeNull();
    expect(cache.getImageCacheStats().evictableEstimatedBytes).toBe(BUDGET_BYTES);
  });

  it('allows temporary multi-entry overshoot while a reservation is active, then reconciles on release', async () => {
    const cache = await loadCache();
    const [a, b, c, d, e, f] = [src('a'), src('b'), src('c'), src('d'), src('e'), src('f')];

    await makeCandidate(cache, a);
    await makeCandidate(cache, b);
    const handleC = await makeCandidate(cache, c);
    const reservation = cache.reserveImageEntry(handleC.entry);

    await makeCandidate(cache, d);
    await makeCandidate(cache, e);
    await makeCandidate(cache, f);

    expect(cache.peekImageEntry(a)).toBeNull();
    expect(cache.peekImageEntry(b)).toBeNull();
    expect(cache.peekImageEntry(c)).toBe(handleC.entry);
    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(4 * IMAGE_BYTES);
    expect(cache.getImageCacheStats().evictableCount).toBe(3);

    reservation?.release();

    expect(cache.peekImageEntry(c)).toBeNull();
    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(3 * IMAGE_BYTES);
    expect(cache.peekImageEntry(d)).not.toBeNull();
    expect(cache.peekImageEntry(e)).not.toBeNull();
    expect(cache.peekImageEntry(f)).not.toBeNull();
  });

  it('enforces the independent 128-entry cap even when byte usage stays tiny', async () => {
    const cache = await loadCache();

    for (let index = 0; index < 129; index += 1) {
      const handle = cache.retainImage(srcSized(`tiny-${index}`, 1, 1));
      await flush();
      handle.release();
    }

    expect(cache.peekImageEntry(srcSized('tiny-0', 1, 1))).toBeNull();
    expect(cache.getImageCacheStats().entryCount).toBe(128);
    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(128 * 4);
  });

  it('maintains incremental stats across loading, loaded, error, retained, and detached transitions', async () => {
    const cache = await loadCache();
    const slow = src('slow');
    const ok = src('ok');
    const broken = src('broken');
    deferDecode(slow);
    rejectDecode(broken);

    const slowHandle = cache.retainImage(slow);
    const okHandle = cache.retainImage(ok);
    const brokenHandle = cache.retainImage(broken);
    await flush();

    expect(cache.getImageCacheStats()).toMatchObject({
      entryCount: 3,
      loadingCount: 1,
      loadedCount: 1,
      errorCount: 1,
      retainedCount: 3,
    });

    slowHandle.release();
    okHandle.release();
    brokenHandle.release();

    expect(cache.getImageCacheStats()).toMatchObject({
      entryCount: 3,
      loadingCount: 1,
      loadedCount: 1,
      errorCount: 1,
      retainedCount: 0,
      evictableCount: 3,
    });

    DEFERRED.get(slow)?.resolve();
    await flush();

    expect(cache.getImageCacheStats()).toMatchObject({
      entryCount: 3,
      loadingCount: 0,
      loadedCount: 2,
      errorCount: 1,
      retainedCount: 0,
    });

    for (const url of [src('a'), src('b'), src('c')]) {
      cache.retainImage(url);
      await flush();
    }

    expect(cache.getImageCacheStats()).toMatchObject({
      entryCount: 6,
      loadingCount: 0,
      loadedCount: 5,
      errorCount: 1,
      retainedCount: 3,
    });
  });

  it('evicts T2 warm entries before T1 entries still inside their grace window', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const cache = await loadCache();
    const warmT1 = cache.warmImage(src('warm-t1'), { tier: 'T1', graceMs: 5_000 });
    const warmT2 = cache.warmImage(src('warm-t2'), { tier: 'T2' });
    const warmT2b = cache.warmImage(src('warm-t2b'), { tier: 'T2' });
    const warmT2c = cache.warmImage(src('warm-t2c'), { tier: 'T2' });
    const warmT2d = cache.warmImage(src('warm-t2d'), { tier: 'T2' });
    await flush();

    const remainingT2 = [warmT2, warmT2b, warmT2c, warmT2d].filter((handle) => cache.peekImageEntry(handle.entry.src) !== null);
    expect(remainingT2).toHaveLength(3);
    expect(cache.peekImageEntry(warmT1.entry.src)).toBe(warmT1.entry);
    expect(cache.getImageCacheStats().evictableEstimatedBytes).toBe(BUDGET_BYTES);
    warmT2b.release();
    warmT2c.release();
    warmT2d.release();
  });

  it('evicts expired T1 warm entries once pressure persists past grace', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const cache = await loadCache();
    const warmT1 = cache.warmImage(src('warm-t1'), { tier: 'T1', graceMs: 1_000 });
    const warmT1b = cache.warmImage(src('warm-t1b'), { tier: 'T1', graceMs: 1_000 });
    const warmT1c = cache.warmImage(src('warm-t1c'), { tier: 'T1', graceMs: 1_000 });
    const warmT1x = cache.warmImage(src('warm-t1x'), { tier: 'T1', graceMs: 1_000 });
    await flush();

    expect(cache.peekImageEntry(warmT1.entry.src)).toBe(warmT1.entry);

    vi.spyOn(Date, 'now').mockReturnValue(3_000);
    const warmT1d = cache.warmImage(src('warm-t1d'), { tier: 'T1', graceMs: 1_000 });
    await flush();

    const remainingExpired = [warmT1, warmT1b, warmT1c, warmT1x].filter((handle) => cache.peekImageEntry(handle.entry.src) !== null);
    expect(remainingExpired).toHaveLength(3);
    expect(cache.peekImageEntry(warmT1d.entry.src)).toBe(warmT1d.entry);
    expect(cache.getImageCacheStats().evictableEstimatedBytes).toBe(BUDGET_BYTES);
    warmT1b.release();
    warmT1c.release();
    warmT1x.release();
  });

  it('cancels abandoned warm loads and allows a clean remount afterwards', async () => {
    const cache = await loadCache();
    const slow = src('slow');
    deferDecode(slow);

    const warm = cache.warmImage(slow, { tier: 'T1', graceMs: 1_000 });
    expect(warm.entry.status).toBe('loading');

    warm.release();
    expect(cache.peekImageEntry(slow)).toBeNull();

    deferDecode(slow);
    const handle = cache.retainImage(slow);
    expect(handle.entry.status).toBe('loading');

    DEFERRED.get(slow)?.resolve();
    await flush();

    expect(cache.peekImageEntry(slow)).toBe(handle.entry);
    expect(handle.entry.status).toBe('loaded');
  });

  it('drops a loaded warm entry immediately when the plan releases it back to T3', async () => {
    const cache = await loadCache();
    const warm = cache.warmImage(src('downgrade'), { tier: 'T2' });
    await flush();

    expect(cache.peekImageEntry(warm.entry.src)).toBe(warm.entry);

    warm.release();

    expect(cache.peekImageEntry('http://media.test/downgrade.png')).toBeNull();
    expect(warm.entry.image.getAttribute('src')).toBeNull();
    expect(cache.getImageCacheStats()).toMatchObject({
      entryCount: 0,
      totalEstimatedBytes: 0,
    });
  });

  it('tracks warm image stats for issued, cancelled, wasted, in-flight, and warm retain hits', async () => {
    const cache = await loadCache();
    const cancelled = src('cancelled');
    deferDecode(cancelled);
    const cancelledWarm = cache.warmImage(cancelled, { tier: 'T1', graceMs: 1_000 });
    expect(cache.getImageCacheStats()).toMatchObject({
      warmTier1Count: 1,
      warmTier2Count: 0,
      warmIssuedCount: 1,
      warmCancelledCount: 0,
      warmWastedCount: 0,
      warmRetainHitCount: 0,
      warmInFlightCount: 1,
    });

    cancelledWarm.release();
    expect(cache.getImageCacheStats()).toMatchObject({
      warmTier1Count: 0,
      warmCancelledCount: 1,
      warmInFlightCount: 0,
    });

    const hit = cache.warmImage(src('hit'), { tier: 'T1', graceMs: 1_000 });
    await flush();
    cache.retainImage(hit.entry.src);
    await flush();
    expect(cache.getImageCacheStats()).toMatchObject({
      warmRetainHitCount: 1,
    });

    const wasted = cache.warmImage(src('wasted'), { tier: 'T2' });
    cache.warmImage(src('wasted-b'), { tier: 'T2' });
    cache.warmImage(src('wasted-c'), { tier: 'T2' });
    cache.warmImage(src('wasted-d'), { tier: 'T2' });
    await flush();
    expect(cache.peekImageEntry(wasted.entry.src)).toBeNull();
    expect(cache.getImageCacheStats()).toMatchObject({
      warmWastedCount: 1,
    });
  });

  it('destroys an evicted loaded warm decode instead of leaving detached bytes unaccounted', async () => {
    const cache = await loadCache();
    const warmA = cache.warmImage(src('warm-a'), { tier: 'T2' });
    cache.warmImage(src('warm-b'), { tier: 'T2' });
    cache.warmImage(src('warm-c'), { tier: 'T2' });
    cache.warmImage(src('warm-d'), { tier: 'T2' });
    await flush();

    expect(cache.peekImageEntry(warmA.entry.src)).toBeNull();
    expect(warmA.entry.image.getAttribute('src')).toBeNull();
    expect(cache.getImageCacheStats()).toMatchObject({
      entryCount: 3,
      totalEstimatedBytes: BUDGET_BYTES,
      warmWastedCount: 1,
    });

    warmA.release();
    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(BUDGET_BYTES);
  });
});

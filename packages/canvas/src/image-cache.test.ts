import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// MAX_ESTIMATED_BYTES in the cache is 96MB. Every stub image below decodes to
// 32MB, so a fourth retained image is what pushes the cache over budget.
const IMAGE_BYTES = 4096 * 2048 * 4;
const BUDGET_BYTES = 96 * 1024 * 1024;

const SIZED = new Map<string, { width: number; height: number }>();
const DEFERRED = new Map<string, { promise: Promise<void>; resolve: () => void }>();

function src(name: string): string {
  const url = `http://media.test/${name}.png`;
  SIZED.set(url, { width: 4096, height: 2048 });
  return url;
}

function deferDecode(url: string) {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  DEFERRED.set(url, { promise, resolve });
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
    return DEFERRED.get(this.src)?.promise ?? Promise.resolve();
  };
}

// Flushes the microtask queue so pending `image.decode()` handlers — and the
// eviction pass they trigger — have run.
function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

type CacheModule = typeof import('./image-cache');

async function loadCache(): Promise<CacheModule> {
  vi.resetModules();
  return import('./image-cache');
}

beforeEach(() => {
  SIZED.clear();
  DEFERRED.clear();
  stubImageElement();
});

afterEach(() => {
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
      const entry = cache.peekImageEntry(url);
      expect(entry, `${url} was evicted while retained`).not.toBeNull();
      expect(entry?.status).toBe('loaded');
      expect(entry?.image.src).toBe(url);
      expect(entry?.image).toBe(handles[index].entry.image);
    }
  });

  it('evicts released entries once the budget is exceeded', async () => {
    const cache = await loadCache();
    const [a, b, c, d] = [src('a'), src('b'), src('c'), src('d')];

    const handleA = cache.retainImage(a);
    await flush();
    cache.retainImage(b);
    await flush();
    cache.retainImage(c);
    await flush();

    // Exactly at budget, so nothing is reclaimed yet even after releasing.
    handleA.release();
    expect(cache.peekImageEntry(a)).not.toBeNull();

    cache.retainImage(d);
    await flush();

    expect(cache.peekImageEntry(a)).toBeNull();
    for (const url of [b, c, d]) expect(cache.peekImageEntry(url)).not.toBeNull();
    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(BUDGET_BYTES);
  });

  it('stops billing bytes for an entry once it has been evicted', async () => {
    const cache = await loadCache();
    const slow = src('slow');
    deferDecode(slow);

    // Retained then released while its decode is still in flight — an
    // abandoned load, which eviction reclaims ahead of anything else.
    cache.retainImage(slow).release();
    expect(cache.peekImageEntry(slow)?.status).toBe('loading');

    for (const url of [src('a'), src('b'), src('c'), src('d')]) {
      cache.retainImage(url);
      await flush();
    }

    expect(cache.peekImageEntry(slow)).toBeNull();
    const bytesAfterEviction = cache.getImageCacheStats().totalEstimatedBytes;

    // The abandoned decode settles late and still reports real dimensions.
    // Billing them now charges the budget for an entry the cache no longer
    // holds — bytes nothing can ever reclaim, permanently shrinking headroom.
    DEFERRED.get(slow)?.resolve();
    await flush();

    expect(cache.getImageCacheStats().totalEstimatedBytes).toBe(bytesAfterEviction);
    expect(bytesAfterEviction).toBe(4 * IMAGE_BYTES);
  });
});

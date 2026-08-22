import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEffect, useLayoutEffect } from 'react';
import type { ResolvedMediaState } from '@lumacast/composition';
import { peekImageEntry, retainImage } from './image-cache';
import { useKImage } from './use-k-image';

const SIZED = new Map<string, { width: number; height: number }>();

function src(name: string): string {
  const url = `http://media.test/${name}.png`;
  SIZED.set(url, { width: 4096, height: 2048 });
  return url;
}

function stubImageElement() {
  const nativeSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;

  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get(this: HTMLImageElement) { return nativeSrc.get!.call(this); },
    set(this: HTMLImageElement, value: string) {
      nativeSrc.set!.call(this, value);
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get() { return true; },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get(this: HTMLImageElement) { return SIZED.get(this.src)?.width ?? 0; },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get(this: HTMLImageElement) { return SIZED.get(this.src)?.height ?? 0; },
  });
  HTMLImageElement.prototype.decode = function decode() {
    return Promise.resolve();
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function useCommitPressure(urls: string[]) {
  useLayoutEffect(() => {
    for (const url of urls) {
      const handle = retainImage(url);
      handle.release();
    }
  }, [urls]);
}

function Probe({
  src,
  pressureUrls,
  onMedia,
}: {
  src: string;
  pressureUrls: string[];
  onMedia: (media: ResolvedMediaState) => void;
}) {
  useCommitPressure(pressureUrls);
  const media = useKImage(src);

  useEffect(() => {
    onMedia(media);
  }, [media, onMedia]);

  return null;
}

describe('useKImage', () => {
  beforeEach(() => {
    SIZED.clear();
    stubImageElement();
  });

  afterEach(() => {
    cleanup();
  });

  it('revives the exact render snapshot if earlier layout work evicts it before reservation', async () => {
    const [a, b, c, d, e, f] = [src('a'), src('b'), src('c'), src('d'), src('e'), src('f')];

    for (const url of [a, b, c]) {
      const handle = retainImage(url);
      await flush();
      handle.release();
    }

    const warmEntry = peekImageEntry(b);
    expect(warmEntry?.status).toBe('loaded');

    const seen: ResolvedMediaState[] = [];
    render(<Probe src={b} pressureUrls={[d, e, f]} onMedia={(media) => { seen.push(media); }} />);

    await waitFor(() => {
      expect(seen.at(-1)).toEqual({ status: 'loaded', resource: warmEntry?.image });
    });

    expect(peekImageEntry(a)).toBeNull();
    expect(peekImageEntry(b)).toBe(warmEntry);
    expect(peekImageEntry(c)).toBeNull();
    expect(peekImageEntry(d)).not.toBeNull();
    expect(peekImageEntry(e)).not.toBeNull();
    expect(peekImageEntry(f)).not.toBeNull();
  });
});

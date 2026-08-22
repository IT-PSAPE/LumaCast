import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazySceneStage } from './lazy-scene-stage';
import { BinShell } from '../layout/bin-shell';

const sceneStageMock = vi.hoisted(() => vi.fn());

vi.mock('@renderer/features/canvas/scene-stage', () => ({
  SceneStage: (props: { className?: string }) => {
    sceneStageMock(props);
    return <div data-testid="scene-stage" className={props.className} />;
  },
}));

interface FakeObserverEntry {
  isIntersecting: boolean;
  target: Element;
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }

  emit(entries: FakeObserverEntry[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

afterEach(() => {
  FakeIntersectionObserver.instances = [];
  sceneStageMock.mockReset();
});

describe('LazySceneStage', () => {
  it('uses the nested BinShell scroller as the observer root and toggles mount/release against it', async () => {
    const scene = { width: 1920, height: 1080 } as never;
    const { container } = render(
      <BinShell>
        <BinShell.Content data-testid="bin-scroll-root">
          <LazySceneStage scene={scene} surface="list" className="stage-host" />
        </BinShell.Content>
      </BinShell>,
    );

    const host = container.querySelector('.stage-host');
    const scrollRoot = screen.getByTestId('bin-scroll-root');

    expect(host).not.toBeNull();
    expect(screen.queryByTestId('scene-stage')).toBeNull();
    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    expect(FakeIntersectionObserver.instances[0]?.options?.root).toBe(scrollRoot);
    expect(FakeIntersectionObserver.instances[0]?.options?.rootMargin).toBe('240px');
    expect(FakeIntersectionObserver.instances[1]?.options?.root).toBe(scrollRoot);
    expect(FakeIntersectionObserver.instances[1]?.options?.rootMargin).toBe('1200px');
    expect(FakeIntersectionObserver.instances[0]?.observe).toHaveBeenCalledWith(host);
    expect(FakeIntersectionObserver.instances[1]?.observe).toHaveBeenCalledWith(host);

    act(() => {
      FakeIntersectionObserver.instances[0]?.emit([{ isIntersecting: true, target: host! }]);
    });
    await waitFor(() => expect(screen.getByTestId('scene-stage')).not.toBeNull());

    act(() => {
      FakeIntersectionObserver.instances[1]?.emit([{ isIntersecting: false, target: host! }]);
    });
    expect(screen.queryByTestId('scene-stage')).toBeNull();
  });
});

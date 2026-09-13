import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { RenderNode, RenderScene } from '@lumacast/composition';
import { SlideRenderHost } from '../../../../../app/renderer/features/render/slide-render-host';
import { renderContactSheet, renderSlideToImage, SlideRenderError, type RenderedSlide } from '../../../../../app/renderer/features/render/render-slide';

// jsdom cannot rasterize Konva, so the whole rendering surface is mocked:
// react-konva's <Stage> forwards its ref to a shared fake stage object
// exposing toDataURL/getLayers, and @lumacast/canvas's scene-node renderers
// are replaced with stand-ins that capture the onMediaLoad callback so tests
// can decide exactly when "an image/video finished loading" happens.
const mocks = vi.hoisted(() => ({
  stage: {
    toDataURL: vi.fn(() => 'data:image/png;base64,FAKE'),
    getLayers: vi.fn(() => [{ getNativeCanvasElement: (): HTMLCanvasElement | null => ({} as HTMLCanvasElement) }]),
  },
  scenesById: new Map<string, RenderScene>(),
  mediaLoadCallbacks: new Map<string, (nodeId: string) => void>(),
  peekImageEntry: vi.fn((_src: string) => null as { status: string } | null),
  mountOrder: [] as string[],
}));

vi.mock('react-konva', async () => {
  const React = await import('react');
  const Stage = React.forwardRef<unknown, { children?: React.ReactNode }>((props, ref) => {
    React.useImperativeHandle(ref, () => mocks.stage, []);
    return React.createElement('div', { 'data-testid': 'fake-stage' }, props.children);
  });
  const Passthrough = (props: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, props.children);
  return { Stage, Layer: Passthrough, Group: Passthrough };
});

vi.mock('@lumacast/canvas', () => ({
  peekImageEntry: (src: string) => mocks.peekImageEntry(src),
  renderSceneNodeContent: (node: RenderNode, _surface: string, options: { onMediaLoad?: (nodeId: string) => void }) => {
    if (options.onMediaLoad) mocks.mediaLoadCallbacks.set(node.id, options.onMediaLoad);
    // A group's children never render for real here (the whole canvas
    // package is mocked out), but their own onMediaLoad still needs to
    // register — walk them the same way scene-node-group.tsx would recurse.
    if (node.element.type === 'group' && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (options.onMediaLoad) mocks.mediaLoadCallbacks.set(child.id, options.onMediaLoad);
      }
    }
    return null;
  },
  SceneSlideBackground: ({ ownerId, onMediaLoad }: { ownerId?: string | null; onMediaLoad?: () => void }) => {
    mocks.mountOrder.push(`mount:${ownerId}`);
    if (onMediaLoad) mocks.mediaLoadCallbacks.set(`background:${ownerId}`, onMediaLoad);
    return null;
  },
  useFontAvailabilityEpoch: () => 0,
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useThumbnailScene: () => (slideId: string) => mocks.scenesById.get(slideId) ?? null,
}));

function makeImageNode(id: string, src: string): RenderNode {
  return {
    id,
    element: {
      id,
      slideId: 'slide-a',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      payload: { src } as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never,
    visual: {
      visible: true,
      locked: false,
      flipX: false,
      flipY: false,
      fillEnabled: false,
      fillColor: '',
      strokeEnabled: false,
      strokeColor: '',
      strokeWidth: 0,
      strokePosition: 'inside',
      borderRadius: 0,
      shadowEnabled: false,
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    } as never,
    isVideo: false,
  };
}

function makeGroupNode(id: string, children: RenderNode[]): RenderNode {
  return {
    id,
    element: {
      id,
      slideId: 'slide-a',
      type: 'group',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      payload: { children: children.map((child) => child.element) } as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never,
    visual: {
      visible: true,
      locked: false,
      flipX: false,
      flipY: false,
      fillEnabled: false,
      fillColor: '',
      strokeEnabled: false,
      strokeColor: '',
      strokeWidth: 0,
      strokePosition: 'inside',
      borderRadius: 0,
      shadowEnabled: false,
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    } as never,
    isVideo: false,
    children,
  };
}

function makeScene(slideId: string, options: { width?: number; height?: number; nodes?: RenderNode[] } = {}): RenderScene {
  return {
    slide: { id: slideId, background: null } as never,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    nodes: options.nodes ?? [],
  };
}

function setDocumentFonts(ready: Promise<unknown>) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready },
  });
}

// renderSlideToImage/renderContactSheet are the app's imperative API, called
// from outside any React event handler — exactly like a real MCP/agent
// caller would. Driving them through fake-timer ticks still causes the host
// to update its own state, so every tick is flushed through act() to keep
// React's test double-checks (and this suite) honest.
async function tick(ms = 16) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flushUntil(check: () => boolean, maxTicks = 50) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (check()) return;
    await tick();
  }
  throw new Error('flushUntil: condition was not met in time');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  mocks.stage.toDataURL.mockClear();
  mocks.stage.toDataURL.mockImplementation(() => 'data:image/png;base64,FAKE');
  mocks.stage.getLayers.mockClear();
  mocks.scenesById.clear();
  mocks.mediaLoadCallbacks.clear();
  mocks.peekImageEntry.mockReset();
  mocks.peekImageEntry.mockReturnValue(null);
  mocks.mountOrder.length = 0;
  setDocumentFonts(Promise.resolve());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('renderSlideToImage', () => {
  it('rejects with not-mounted when no host is mounted', async () => {
    await expect(renderSlideToImage('slide-a')).rejects.toMatchObject({
      code: 'not-mounted',
    });
  });

  it('rejects with not-found for an unknown slide id', async () => {
    render(<SlideRenderHost />);

    let error: unknown;
    act(() => {
      renderSlideToImage('missing-slide').catch((caught) => { error = caught; });
    });
    await flushUntil(() => error !== undefined);

    expect(error).toBeInstanceOf(SlideRenderError);
    expect((error as SlideRenderError).code).toBe('not-found');
  });

  it('resolves with the captured data URL at the requested dimensions', async () => {
    mocks.scenesById.set('slide-a', makeScene('slide-a', { width: 1920, height: 1080 }));
    render(<SlideRenderHost />);

    let result: RenderedSlide | undefined;
    act(() => {
      renderSlideToImage('slide-a', { width: 640 }).then((value) => { result = value; });
    });

    await flushUntil(() => result !== undefined);

    expect(result).toEqual({
      slideId: 'slide-a',
      dataUrl: 'data:image/png;base64,FAKE',
      width: 640,
      height: 360,
      format: 'png',
    });
    expect(mocks.stage.toDataURL).toHaveBeenCalledTimes(1);
    expect(mocks.stage.toDataURL).toHaveBeenCalledWith({ mimeType: 'image/png', quality: undefined, pixelRatio: 640 / 1920 });
  });

  it('waits for pending fonts and images before capturing', async () => {
    const imageNode = makeImageNode('node-image-1', 'media://one.png');
    mocks.scenesById.set('slide-a', makeScene('slide-a', { nodes: [imageNode] }));

    let resolveFonts!: () => void;
    setDocumentFonts(new Promise<void>((resolve) => { resolveFonts = resolve; }));

    render(<SlideRenderHost />);

    let result: RenderedSlide | undefined;
    let error: unknown;
    act(() => {
      renderSlideToImage('slide-a').then((value) => { result = value; }, (caught) => { error = caught; });
    });

    // The scene is mounted (the image node registered its onMediaLoad), but
    // neither the image nor the fonts have settled yet.
    await tick();
    await tick();
    await tick();
    expect(mocks.mediaLoadCallbacks.has('node-image-1')).toBe(true);
    expect(mocks.stage.toDataURL).not.toHaveBeenCalled();

    // The image resolves; capture must still wait on the pending font load.
    mocks.mediaLoadCallbacks.get('node-image-1')?.('node-image-1');
    await tick();
    await tick();
    await tick();
    expect(mocks.stage.toDataURL).not.toHaveBeenCalled();

    // Fonts settle: capture proceeds (after its two paint rAFs).
    resolveFonts();
    await flushUntil(() => result !== undefined || error !== undefined);

    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    expect(mocks.stage.toDataURL).toHaveBeenCalledTimes(1);
  });

  it('waits for an image nested inside a group before capturing', async () => {
    const nestedImage = makeImageNode('node-image-nested', 'media://nested.png');
    const groupNode = makeGroupNode('node-group-1', [nestedImage]);
    mocks.scenesById.set('slide-a', makeScene('slide-a', { nodes: [groupNode] }));

    render(<SlideRenderHost />);

    let result: RenderedSlide | undefined;
    act(() => {
      renderSlideToImage('slide-a').then((value) => { result = value; });
    });

    // The nested child registers its own wait slot (keyed by its own id, not
    // the group's), and capture must not proceed until it resolves.
    await tick();
    await tick();
    await tick();
    expect(mocks.mediaLoadCallbacks.has('node-image-nested')).toBe(true);
    expect(mocks.stage.toDataURL).not.toHaveBeenCalled();

    mocks.mediaLoadCallbacks.get('node-image-nested')?.('node-image-nested');
    await flushUntil(() => result !== undefined);

    expect(result).toBeDefined();
    expect(mocks.stage.toDataURL).toHaveBeenCalledTimes(1);
  });

  it('treats a permanently broken image (image-cache error status) as settled', async () => {
    const imageNode = makeImageNode('node-image-1', 'media://broken.png');
    mocks.scenesById.set('slide-a', makeScene('slide-a', { nodes: [imageNode] }));
    mocks.peekImageEntry.mockImplementation((src: string) => (src === 'media://broken.png' ? { status: 'error' } : null));

    render(<SlideRenderHost />);

    let result: RenderedSlide | undefined;
    act(() => {
      renderSlideToImage('slide-a').then((value) => { result = value; });
    });

    // onMediaLoad never fires for broken media; only the image-cache poll
    // reports it settled, so capture must still complete well before the
    // job's own timeout.
    await flushUntil(() => result !== undefined);
    expect(mocks.stage.toDataURL).toHaveBeenCalledTimes(1);
  });

  it('rejects with timeout when media never settles', async () => {
    const imageNode = makeImageNode('node-image-1', 'media://stuck.png');
    mocks.scenesById.set('slide-a', makeScene('slide-a', { nodes: [imageNode] }));

    render(<SlideRenderHost />);

    let error: unknown;
    act(() => {
      renderSlideToImage('slide-a', { timeoutMs: 200 }).catch((caught) => { error = caught; });
    });

    await flushUntil(() => error !== undefined, 60);

    expect(error).toBeInstanceOf(SlideRenderError);
    expect((error as SlideRenderError).code).toBe('timeout');
    expect(mocks.stage.toDataURL).not.toHaveBeenCalled();
  });

  it('falls back to the bitmap capture path when toDataURL throws', async () => {
    mocks.scenesById.set('slide-a', makeScene('slide-a'));
    mocks.stage.toDataURL.mockImplementation(() => {
      throw new Error('tainted canvas');
    });

    const fakeBitmap = { width: 10, height: 10, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { drawImage: vi.fn() };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(['fake-bytes'], { type: 'image/png' }));
      }
    });

    render(<SlideRenderHost />);

    let result: RenderedSlide | undefined;
    let error: unknown;
    act(() => {
      renderSlideToImage('slide-a').then((value) => { result = value; }, (caught) => { error = caught; });
    });

    await flushUntil(() => result !== undefined || error !== undefined);

    expect(error).toBeUndefined();
    expect(result?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rejects with capture-failed when both the primary and fallback capture paths fail', async () => {
    mocks.scenesById.set('slide-a', makeScene('slide-a'));
    mocks.stage.toDataURL.mockImplementation(() => {
      throw new Error('tainted canvas');
    });
    mocks.stage.getLayers.mockReturnValue([{ getNativeCanvasElement: () => null }]);

    render(<SlideRenderHost />);

    let error: unknown;
    act(() => {
      renderSlideToImage('slide-a').catch((caught) => { error = caught; });
    });

    await flushUntil(() => error !== undefined);
    expect(error).toBeInstanceOf(SlideRenderError);
    expect((error as SlideRenderError).code).toBe('capture-failed');
  });

  it('processes two concurrent requests one at a time, in FIFO order', async () => {
    mocks.scenesById.set('slide-a', makeScene('slide-a'));
    mocks.scenesById.set('slide-b', makeScene('slide-b'));

    render(<SlideRenderHost />);

    const order: string[] = [];
    let first!: Promise<RenderedSlide>;
    let second!: Promise<RenderedSlide>;
    act(() => {
      first = renderSlideToImage('slide-a').then((value) => { order.push(`resolved:${value.slideId}`); return value; });
      second = renderSlideToImage('slide-b').then((value) => { order.push(`resolved:${value.slideId}`); return value; });
    });

    await flushUntil(() => order.length === 2);
    await Promise.all([first, second]);

    // slide-b's scene must not mount until slide-a's job has fully settled.
    expect(mocks.mountOrder).toEqual(['mount:slide-a', 'mount:slide-b']);
    expect(order).toEqual(['resolved:slide-a', 'resolved:slide-b']);
  });
});

describe('renderContactSheet', () => {
  it('composes tiles in the requested column count with labels', async () => {
    mocks.scenesById.set('slide-1', makeScene('slide-1'));
    mocks.scenesById.set('slide-2', makeScene('slide-2'));
    mocks.scenesById.set('slide-3', makeScene('slide-3'));
    mocks.scenesById.set('slide-4', makeScene('slide-4'));

    const fillTextCalls: unknown[][] = [];
    const drawImageCalls: unknown[][] = [];
    const fakeCtx = {
      fillStyle: '',
      font: '',
      textAlign: '' as CanvasTextAlign,
      textBaseline: '' as CanvasTextBaseline,
      fillRect: vi.fn(),
      drawImage: vi.fn((...args: unknown[]) => { drawImageCalls.push(args); }),
      fillText: vi.fn((...args: unknown[]) => { fillTextCalls.push(args); }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as RenderingContext);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,SHEET');

    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);

    render(<SlideRenderHost />);

    let sheet: (RenderedSlide & { slideIds: string[] }) | undefined;
    act(() => {
      renderContactSheet(['slide-1', 'slide-2', 'slide-3', 'slide-4'], { columns: 2, thumbnailWidth: 100 })
        .then((value) => { sheet = value; });
    });

    await flushUntil(() => sheet !== undefined, 200);

    // Each tile is 100 wide, 56 tall (1920x1080 aspect), plus a 28px label
    // row; a 2-column, 2-row grid with the default 16px gap.
    expect(sheet).toMatchObject({
      slideIds: ['slide-1', 'slide-2', 'slide-3', 'slide-4'],
      format: 'png',
      width: 216,
      height: 184,
    });
    expect(drawImageCalls).toHaveLength(4);
    expect(fillTextCalls).toHaveLength(4);
    expect(fillTextCalls.map((call) => call[0])).toEqual(['1', '2', '3', '4']);
  });

  it('omits labels when label: false', async () => {
    mocks.scenesById.set('slide-1', makeScene('slide-1'));
    mocks.scenesById.set('slide-2', makeScene('slide-2'));

    const fillTextCalls: unknown[][] = [];
    const fakeCtx = {
      fillStyle: '',
      font: '',
      textAlign: '' as CanvasTextAlign,
      textBaseline: '' as CanvasTextBaseline,
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn((...args: unknown[]) => { fillTextCalls.push(args); }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as RenderingContext);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,SHEET');

    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);

    render(<SlideRenderHost />);

    let sheet: (RenderedSlide & { slideIds: string[] }) | undefined;
    act(() => {
      renderContactSheet(['slide-1', 'slide-2'], { columns: 2, thumbnailWidth: 100, label: false })
        .then((value) => { sheet = value; });
    });

    await flushUntil(() => sheet !== undefined, 200);

    expect(sheet).toMatchObject({ width: 216, height: 56 });
    expect(fillTextCalls).toHaveLength(0);
  });
});

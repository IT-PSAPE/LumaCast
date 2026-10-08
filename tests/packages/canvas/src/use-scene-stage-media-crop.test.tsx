import Konva from 'konva';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import type { MediaCrop } from '@lumacast/composition';
import type { ElementUpdateInput } from '@lumacast/protocol';
import { useSceneStageMediaCrop } from '../../../../packages/canvas/src/use-scene-stage-media-crop';

const PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(navigator, 'platform');

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const data = new Uint8ClampedArray(400);
    for (let index = 0; index < 100; index += 1) {
      data[index * 4] = 40;
      data[index * 4 + 1] = 40;
      data[index * 4 + 2] = 40;
      data[index * 4 + 3] = 255;
    }
    return {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: () => ({ data }),
    } as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  cleanup();
  if (PLATFORM_DESCRIPTOR) Object.defineProperty(navigator, 'platform', PLATFORM_DESCRIPTOR);
});

afterAll(() => vi.restoreAllMocks());

function setPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
}

type TestElement = {
  id: string;
  slideId: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceThemeElementId?: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
};

type TestElementUpdate = ElementUpdateInput & {
  width: number;
  height: number;
  payload: NonNullable<ElementUpdateInput['payload']> & { crop: MediaCrop; cropFrame: MediaCrop; fit?: unknown };
};

function element(overrides: Record<string, unknown> = {}, payloadOverrides: Record<string, unknown> = {}): TestElement {
  return {
    id: 'image-1',
    slideId: 'slide-1',
    type: 'image',
    x: 20,
    y: 30,
    width: 300,
    height: 150,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload: { src: 'image.png', visible: true, locked: false, fit: 'cover', ...payloadOverrides },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as TestElement;
}

function createHarness(options: {
  platform?: string;
  anchor?: string;
  element?: TestElement;
  baseElement?: TestElement;
  selectedIds?: string[];
  resource?: Record<string, number>;
  nodeAttrs?: Record<string, number>;
  parentAttrs?: Record<string, number> | null;
  sourceCrop?: { x: number; y: number; width: number; height: number };
  sourceSize?: { width: number; height: number };
} = {}) {
  setPlatform(options.platform ?? 'Linux x86_64');
  let pointer = { x: 0, y: 0 };
  const mediaSize = options.sourceSize ?? { width: 1200, height: 600 };
  const image = new Konva.Image({
    name: 'element-media',
    image: (options.resource ?? { naturalWidth: mediaSize.width, naturalHeight: mediaSize.height }) as unknown as HTMLImageElement,
    x: 0,
    y: 0,
    width: 300,
    height: 150,
    crop: options.sourceCrop ?? { x: 0, y: 0, width: mediaSize.width, height: mediaSize.height },
  });
  const backdrop = new Konva.Rect({ x: 0, y: 0, width: 300, height: 150, fill: '#000000' });
  const node = new Konva.Group({
    x: 20,
    y: 30,
    width: 300,
    height: 150,
    offsetX: options.nodeAttrs?.scaleX === -1 ? 300 : 0,
    offsetY: options.nodeAttrs?.scaleY === -1 ? 150 : 0,
    ...options.nodeAttrs,
  });
  node.add(backdrop);
  node.add(image);
  let parent: Konva.Group | null = null;
  if (options.parentAttrs) {
    parent = new Konva.Group(options.parentAttrs);
    parent.add(node);
  }
  const targetElement = options.element ?? element();
  const baseElement = options.baseElement ?? targetElement;
  const selectedIds = options.selectedIds ?? ['image-1'];
  const stage = { getPointerPosition: () => pointer };
  const transformer = {
    getActiveAnchor: () => options.anchor ?? 'bottom-right',
    forceUpdate: vi.fn(),
  };
  const setCanvasInteracting = vi.fn();
  const applyDraftPatch = vi.fn();
  const flushDraftBuffer = vi.fn();
  const setDraftElements = vi.fn();
  const commitElementUpdates = vi.fn(async (_updates: ElementUpdateInput[]) => undefined);
  const refs = {
    stageRef: { current: stage },
    transformerRef: { current: transformer },
    nodeRefs: { current: new Map([['image-1', node]]) },
    effectiveElementsRef: { current: [targetElement] },
    baseElementsRef: { current: [baseElement] },
    selectedElementIdsRef: { current: selectedIds },
  };
  const hook = renderHook(() => useSceneStageMediaCrop({
    editable: true,
    ...refs,
    applyDraftPatch,
    flushDraftBuffer,
    elements: { commitElementUpdates, setDraftElements, setCanvasInteracting },
  } as never));

  function start(modifier: 'meta' | 'ctrl' | 'both' | 'none' = 'ctrl') {
    const screenTransform = node.getAbsoluteTransform().copy();
    const localStart = anchorPoint(options.anchor ?? 'bottom-right', node.width(), node.height());
    if (node.scaleX() < 0) localStart.x = node.width() - localStart.x;
    if (node.scaleY() < 0) localStart.y = node.height() - localStart.y;
    pointer = screenTransform.point(localStart);
    const evt = {
      metaKey: modifier === 'meta' || modifier === 'both',
      ctrlKey: modifier === 'ctrl' || modifier === 'both',
    };
    act(() => hook.result.current.handleTransformStart({ evt } as never));
    return screenTransform;
  }

  function move(screenTransform: Konva.Transform, x: number, y: number) {
    pointer = screenTransform.point({ x, y });
    let handled = false;
    act(() => { handled = hook.result.current.handleTransform(); });
    return handled;
  }

  async function end() {
    let handled = false;
    await act(async () => { handled = await hook.result.current.handleTransformEnd(); });
    return handled;
  }

  return {
    hook, node, image, backdrop, parent, refs, targetElement, transformer, setCanvasInteracting,
    applyDraftPatch, flushDraftBuffer, setDraftElements, commitElementUpdates,
    start, move, end,
  };
}

function committedUpdate(commit: Mock<(updates: ElementUpdateInput[]) => Promise<void>>): TestElementUpdate {
  const update = commit.mock.calls[0]?.[0]?.[0];
  if (!update) throw new Error('Expected a committed crop update.');
  return update as TestElementUpdate;
}

function anchorPoint(anchor: string, width: number, height: number) {
  const points: Record<string, { x: number; y: number }> = {
    'top-left': { x: 0, y: 0 }, 'top-center': { x: width / 2, y: 0 }, 'top-right': { x: width, y: 0 },
    'middle-right': { x: width, y: height / 2 }, 'bottom-right': { x: width, y: height },
    'bottom-center': { x: width / 2, y: height }, 'bottom-left': { x: 0, y: height }, 'middle-left': { x: 0, y: height / 2 },
    rotater: { x: width / 2, y: 0 },
  };
  return points[anchor] ?? points['bottom-right'];
}

describe('useSceneStageMediaCrop', () => {
  it.each([
    ['MacIntel', 'meta', 'ctrl'],
    ['iPhone', 'meta', 'ctrl'],
    ['Linux x86_64', 'ctrl', 'meta'],
    ['Win32', 'ctrl', 'meta'],
  ])('requires the platform modifier on %s', async (platform, accepted, rejected) => {
    const acceptedHarness = createHarness({ platform });
    acceptedHarness.start(accepted as 'meta' | 'ctrl');
    expect(acceptedHarness.setCanvasInteracting).toHaveBeenCalledWith(true);
    await acceptedHarness.end();
    expect(acceptedHarness.commitElementUpdates).not.toHaveBeenCalled();

    const rejectedHarness = createHarness({ platform });
    rejectedHarness.start(rejected as 'meta' | 'ctrl');
    expect(rejectedHarness.setCanvasInteracting).not.toHaveBeenCalled();
    expect(rejectedHarness.hook.result.current.handleTransform()).toBe(false);
    expect(rejectedHarness.commitElementUpdates).not.toHaveBeenCalled();
  });

  it.each([
    ['shape', element({ type: 'shape' })],
    ['group', element({ type: 'group' })],
    ['locked media', element({}, { locked: true })],
    ['hidden media', element({}, { visible: false })],
  ])('leaves standard transformer gestures alone for %s', (_name, targetElement) => {
    const harness = createHarness({ element: targetElement });
    harness.start('ctrl');
    expect(harness.setCanvasInteracting).not.toHaveBeenCalled();
    expect(harness.hook.result.current.handleTransform()).toBe(false);
  });

  it('does not take over multiple selection or the rotation handle', () => {
    const multiselect = createHarness({ selectedIds: ['image-1', 'other'] });
    multiselect.start('ctrl');
    expect(multiselect.setCanvasInteracting).not.toHaveBeenCalled();

    const rotation = createHarness({ anchor: 'rotater' });
    rotation.start('ctrl');
    expect(rotation.setCanvasInteracting).not.toHaveBeenCalled();
    expect(rotation.hook.result.current.handleTransform()).toBe(false);
  });

  it('uses source-pixel mapping to preserve pixels while cropping a corner at the frame ratio', async () => {
    const harness = createHarness();
    const transform = harness.start('ctrl');
    expect(harness.move(transform, 270, 135)).toBe(true);
    await harness.end();
    const update = committedUpdate(harness.commitElementUpdates);
    expect(update.width / update.height).toBeCloseTo(2);
    expect(update.width / (update.payload.crop.width * 1200)).toBeCloseTo(300 / 1200);
    expect(update.height / (update.payload.crop.height * 600)).toBeCloseTo(150 / 600);
    expect(harness.image.width()).toBeCloseTo(update.width);
    expect(harness.image.crop().width).toBeCloseTo(update.payload.crop.width * 1200);
  });

  it('keeps a side handle axis-only and commits its source crop', async () => {
    const harness = createHarness({ anchor: 'middle-right' });
    const transform = harness.start('ctrl');
    harness.move(transform, 270, 75);
    await harness.end();
    const update = committedUpdate(harness.commitElementUpdates);
    expect(update.width).toBeCloseTo(270);
    expect(update.height).toBe(150);
    expect(update.payload.crop.width).toBeCloseTo(270 / 300);
    expect(update.payload.crop.height).toBe(1);
  });

  it('maps pointer motion through rotation, flips, and a scaled parent', async () => {
    const harness = createHarness({
      nodeAttrs: { rotation: 27, scaleX: -1, scaleY: 1 },
      parentAttrs: { x: 80, y: 50, scaleX: 2, scaleY: 1.5 },
    });
    const transform = harness.start('ctrl');
    // The visual bottom-right maps to the node's local bottom-left under the flip.
    expect(transform.point(anchorPoint('bottom-right', harness.node.width(), harness.node.height()))).not.toEqual({ x: 0, y: 0 });
    expect(harness.move(transform, 30, 135)).toBe(true);
    await harness.end();
    const update = committedUpdate(harness.commitElementUpdates);
    expect(update.width / update.height).toBeCloseTo(2);
    expect(harness.node.scaleX()).toBe(-1);
    expect(update.payload.crop.width).toBeLessThan(1);
  });

  it('does not commit when source dimensions are unavailable', async () => {
    const harness = createHarness({ resource: {} });
    const before = { x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() };
    const transform = harness.start('ctrl');
    expect(harness.move(transform, 270, 135)).toBe(true);
    await harness.end();
    expect(harness.commitElementUpdates).not.toHaveBeenCalled();
    expect({ x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() }).toEqual(before);
  });

  it('uses the original draw mapping for each tick and commits once at the end', async () => {
    const harness = createHarness();
    const transform = harness.start('ctrl');
    harness.move(transform, 270, 135);
    harness.move(transform, 280, 140);
    expect(harness.commitElementUpdates).not.toHaveBeenCalled();
    expect(harness.node.width()).toBeCloseTo(280);
    expect(harness.node.height()).toBeCloseTo(140);
    await harness.end();
    expect(harness.commitElementUpdates).toHaveBeenCalledOnce();
    expect(committedUpdate(harness.commitElementUpdates).width).toBeCloseTo(280);
  });

  it('keeps normalized mapping stable when the media resource resolution changes mid-gesture', async () => {
    const harness = createHarness({ sourceSize: { width: 1200, height: 600 } });
    const transform = harness.start('ctrl');

    harness.move(transform, 270, 135);
    expect(harness.image.crop().width).toBeCloseTo(1080);
    expect(harness.image.width() * 1200 / harness.image.crop().width).toBeCloseTo(300);

    harness.image.image({ naturalWidth: 2400, naturalHeight: 1200 } as unknown as HTMLImageElement);
    harness.move(transform, 280, 140);
    await harness.end();

    const update = committedUpdate(harness.commitElementUpdates);
    expect(update.payload.crop.x).toBe(0);
    expect(update.payload.crop.y).toBe(0);
    expect(update.payload.crop.width).toBeCloseTo(280 / 300);
    expect(update.payload.crop.height).toBeCloseTo(140 / 150);
    expect(harness.image.crop().width).toBeCloseTo(update.payload.crop.width * 2400);
    expect(harness.image.crop().height).toBeCloseTo(update.payload.crop.height * 1200);
    expect(harness.image.width() * 2400 / harness.image.crop().width).toBeCloseTo(300);
    expect(harness.image.height() * 1200 / harness.image.crop().height).toBeCloseTo(150);
  });

  it('commits only crop fields for a themed element, without resolved fit', async () => {
    const themed = element({ sourceThemeElementId: 'theme-media' }, { src: 'image.png', locked: false, visible: true });
    const authored = element({ sourceThemeElementId: 'theme-media' }, { src: 'image.png', locked: false, visible: true });
    delete authored.payload.fit;
    const harness = createHarness({ element: themed, baseElement: authored });
    const transform = harness.start('ctrl');
    harness.move(transform, 270, 135);
    await harness.end();
    const update = committedUpdate(harness.commitElementUpdates);
    expect(update.payload).toHaveProperty('crop');
    expect(update.payload).toHaveProperty('cropFrame');
    expect(update.payload).not.toHaveProperty('fit');
    expect(update.themeOverrideKeys).toEqual(['crop', 'cropFrame']);
  });

  it('does not commit a session with no transform updates', async () => {
    const harness = createHarness();
    const transform = harness.start('ctrl');
    harness.move(transform, 300, 150);
    await harness.end();
    expect(harness.commitElementUpdates).not.toHaveBeenCalled();
    expect(harness.flushDraftBuffer).toHaveBeenCalledOnce();
    expect(harness.setCanvasInteracting).toHaveBeenLastCalledWith(false);
  });

  it('restores the original node, media, and draft when a previewed drag returns to its start', async () => {
    const harness = createHarness();
    const nodeBefore = { x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() };
    const mediaBefore = { ...harness.image.getAttrs() };
    const rectBefore = { ...harness.backdrop.getAttrs() };
    const transform = harness.start('ctrl');

    harness.move(transform, 270, 135);
    expect(harness.node.width()).toBeCloseTo(270);
    expect(harness.image.crop().width).toBeLessThan(1200);
    expect(harness.backdrop.width()).toBeCloseTo(270);

    harness.move(transform, 300, 150);
    expect({ x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() }).toEqual(nodeBefore);
    expect(harness.image.getAttrs()).toEqual(mediaBefore);
    expect(harness.backdrop.getAttrs()).toEqual(rectBefore);
    await harness.end();

    expect(harness.commitElementUpdates).not.toHaveBeenCalled();
    expect(harness.setDraftElements).toHaveBeenCalledOnce();
    const removePreview = harness.setDraftElements.mock.calls[0][0] as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(removePreview({ 'image-1': { x: 99 }, other: { x: 1 } })).toEqual({ other: { x: 1 } });
  });

  it('clears the failed draft and restores the initial node when commit fails', async () => {
    const harness = createHarness();
    const before = { x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() };
    const mediaBefore = { ...harness.image.getAttrs() };
    const rectBefore = { ...harness.backdrop.getAttrs() };
    harness.commitElementUpdates.mockRejectedValueOnce(new Error('save failed'));
    const transform = harness.start('ctrl');
    harness.move(transform, 270, 135);
    await harness.end();
    expect(harness.setDraftElements).toHaveBeenCalledOnce();
    const updateDrafts = harness.setDraftElements.mock.calls[0][0] as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(updateDrafts({ 'image-1': { x: 99 }, other: { x: 1 } })).toEqual({ other: { x: 1 } });
    expect({ x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() }).toEqual(before);
    expect(harness.image.getAttrs()).toEqual(mediaBefore);
    expect(harness.backdrop.getAttrs()).toEqual(rectBefore);
    expect(harness.setCanvasInteracting).toHaveBeenLastCalledWith(false);
  });

  it('keeps a swapped full-resolution resource and rescales the original pixel crop after commit failure', async () => {
    const harness = createHarness({ sourceSize: { width: 1200, height: 600 } });
    const nodeBefore = { x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() };
    const rectBefore = { ...harness.backdrop.getAttrs() };
    const replacement = { naturalWidth: 2400, naturalHeight: 1200 } as unknown as HTMLImageElement;
    harness.commitElementUpdates.mockRejectedValueOnce(new Error('save failed'));
    const transform = harness.start('ctrl');

    harness.move(transform, 270, 135);
    harness.image.image(replacement);
    harness.move(transform, 280, 140);
    await harness.end();

    expect(harness.image.image()).toBe(replacement);
    expect(harness.image.crop()).toEqual({ x: 0, y: 0, width: 2400, height: 1200 });
    expect({ x: harness.node.x(), y: harness.node.y(), width: harness.node.width(), height: harness.node.height() }).toEqual(nodeBefore);
    expect(harness.image.x()).toBe(0);
    expect(harness.image.y()).toBe(0);
    expect(harness.image.width()).toBe(300);
    expect(harness.image.height()).toBe(150);
    expect(harness.backdrop.getAttrs()).toEqual(rectBefore);
    expect(harness.commitElementUpdates).toHaveBeenCalledOnce();
    const removePreview = harness.setDraftElements.mock.calls[0][0] as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(removePreview({ 'image-1': { x: 99 }, other: { x: 1 } })).toEqual({ other: { x: 1 } });
  });
});

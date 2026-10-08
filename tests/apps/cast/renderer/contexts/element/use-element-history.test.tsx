import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideElement } from '@lumacast/composition';
import type { ElementUpdateInput } from '@lumacast/protocol';
import { useElementHistory } from '../../../../../../apps/cast/renderer/contexts/element/use-element-history';

const ELEMENTS = [
  {
    id: 'el-1',
    slideId: 'slide-1',
    type: 'shape',
    x: 10,
    y: 20,
    width: 300,
    height: 180,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload: {
      fillEnabled: true,
      fillColor: '#FFFFFF',
      strokeEnabled: false,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
] as const;

const CROP_A = { x: 0.1, y: 0.2, width: 0.4, height: 0.5 };
const CROP_B = { x: 0.3, y: 0.1, width: 0.5, height: 0.6 };
const CROP_FRAME_A = { x: 0.1, y: 0.15, width: 0.75, height: 0.7 };
const CROP_FRAME_B = { x: 0.2, y: 0.1, width: 0.65, height: 0.8 };

function videoElement(crop: typeof CROP_A | null, cropFrame: typeof CROP_FRAME_A | null = CROP_FRAME_A) {
  return {
    id: 'video-1',
    slideId: 'slide-1',
    type: 'video',
    x: 10,
    y: 20,
    width: 300,
    height: 180,
    rotation: -17,
    opacity: 1,
    zIndex: 1,
    layer: 'media',
    sourceThemeElementId: 'theme-video-1',
    themeOverrideKeys: ['crop', 'cropFrame', 'fit', 'flipX', 'flipY', 'src', 'playbackRate'],
    payload: {
      src: 'asset://clip.mp4',
      crop,
      cropFrame,
      fit: 'cover',
      flipX: true,
      flipY: false,
      autoplay: true,
      loop: true,
      muted: false,
      playbackRate: 1.25,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as SlideElement;
}

describe('useElementHistory identity', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps its returned object stable when the inputs are unchanged', () => {
    const props = {
      baseElements: ELEMENTS as never,
      effectiveElements: ELEMENTS as never,
      activeEditorEntityId: 'slide-1',
      hasActiveEditorSource: true,
      historyKey: 'slide-1',
      selectedElementIds: ['el-1'],
      mutatePatch: vi.fn(async () => ({}) as never),
      setStatusText: vi.fn(),
      selectElements: vi.fn(),
      setDraftElements: vi.fn(),
      setCanvasInteracting: vi.fn(),
      saveElementUpdates: vi.fn(async () => undefined),
      replaceElements: vi.fn(async () => undefined),
    };

    const { result, rerender } = renderHook((input) => useElementHistory(input), {
      initialProps: props,
    });

    const first = result.current;

    rerender(props);

    expect(result.current).toBe(first);
  });
});

describe('useElementHistory media crops', () => {
  afterEach(() => {
    cleanup();
  });

  function setup(element: ReturnType<typeof videoElement>) {
    const replaceElements = vi.fn(async (_elements: SlideElement[]) => undefined);
    const props = {
      baseElements: [element],
      effectiveElements: [element],
      activeEditorEntityId: 'slide-1',
      hasActiveEditorSource: true,
      historyKey: 'slide-1',
      selectedElementIds: ['video-1'],
      mutatePatch: vi.fn(async () => ({}) as never),
      setStatusText: vi.fn(),
      selectElements: vi.fn(),
      setDraftElements: vi.fn(),
      setCanvasInteracting: vi.fn(),
      saveElementUpdates: vi.fn(async (_updates: ElementUpdateInput[]) => undefined),
      replaceElements,
    };
    const hook = renderHook((input) => useElementHistory(input), { initialProps: props });
    return { ...hook, props, replaceElements };
  }

  it('undoes and redoes crop commits while preserving media and theme fields', async () => {
    const original = videoElement(CROP_A);
    const committed = videoElement(CROP_B, CROP_FRAME_B);
    const { result, rerender, props, replaceElements } = setup(original);

    await act(async () => {
      await result.current.commitElementUpdates([{
        id: 'video-1',
        payload: { ...(original as { payload: object }).payload, crop: CROP_B },
      } as never]);
    });
    rerender({ ...props, baseElements: [committed], effectiveElements: [committed] });

    await act(async () => result.current.undo());
    const undone = replaceElements.mock.calls.at(-1)?.[0]?.[0] as typeof original | undefined;
    expect(undone).toMatchObject({
      rotation: -17,
      themeOverrideKeys: ['crop', 'cropFrame', 'fit', 'flipX', 'flipY', 'src', 'playbackRate'],
      payload: { crop: CROP_A, cropFrame: CROP_FRAME_A, fit: 'cover', flipX: true, flipY: false, src: 'asset://clip.mp4', autoplay: true, loop: true, muted: false, playbackRate: 1.25 },
    });
    rerender({ ...props, baseElements: [original], effectiveElements: [original] });

    await act(async () => result.current.redo());
    const redone = replaceElements.mock.calls.at(-1)?.[0]?.[0] as typeof committed | undefined;
    expect(redone).toMatchObject({
      rotation: -17,
      themeOverrideKeys: ['crop', 'cropFrame', 'fit', 'flipX', 'flipY', 'src', 'playbackRate'],
      payload: { crop: CROP_B, cropFrame: CROP_FRAME_B, fit: 'cover', flipX: true, flipY: false, src: 'asset://clip.mp4', autoplay: true, loop: true, muted: false, playbackRate: 1.25 },
    });
  });

  it('undoes and redoes an explicit null crop reset', async () => {
    const cropped = videoElement(CROP_A);
    const reset = videoElement(null, null);
    const { result, rerender, props, replaceElements } = setup(cropped);

    await act(async () => {
      await result.current.commitElementUpdates([{
        id: 'video-1',
        payload: { ...(cropped as { payload: object }).payload, crop: null, cropFrame: null },
      } as never]);
    });
    rerender({ ...props, baseElements: [reset], effectiveElements: [reset] });

    await act(async () => result.current.undo());
    expect(replaceElements.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({
      rotation: -17,
      payload: { crop: CROP_A, cropFrame: CROP_FRAME_A, fit: 'cover', flipX: true, flipY: false, src: 'asset://clip.mp4', autoplay: true, loop: true, muted: false, playbackRate: 1.25 },
      themeOverrideKeys: ['crop', 'cropFrame', 'fit', 'flipX', 'flipY', 'src', 'playbackRate'],
    });
    rerender({ ...props, baseElements: [cropped], effectiveElements: [cropped] });

    await act(async () => result.current.redo());
    expect(replaceElements.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({
      rotation: -17,
      payload: { crop: null, cropFrame: null, fit: 'cover', flipX: true, flipY: false, src: 'asset://clip.mp4', autoplay: true, loop: true, muted: false, playbackRate: 1.25 },
      themeOverrideKeys: ['crop', 'cropFrame', 'fit', 'flipX', 'flipY', 'src', 'playbackRate'],
    });
  });

  it('copies and pastes media payloads with crop, fit, source, and playback settings', async () => {
    const source = videoElement(CROP_B, CROP_FRAME_B);
    const { result, replaceElements } = setup(source);

    act(() => result.current.copySelection());
    await act(async () => result.current.pasteSelection());

    const pasted = replaceElements.mock.calls.at(-1)?.[0]?.[1] as typeof source | undefined;
    expect(pasted).toMatchObject({
      rotation: -17,
      payload: { crop: CROP_B, cropFrame: CROP_FRAME_B, fit: 'cover', flipX: true, flipY: false, src: 'asset://clip.mp4', autoplay: true, loop: true, muted: false, playbackRate: 1.25 },
    });
  });
});

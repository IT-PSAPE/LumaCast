import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Id } from '@lumacast/kernel';
import type { Slide, SlideElement } from '@lumacast/composition';
import type { SnapshotPatch } from '@lumacast/protocol';
import { useLyricEditorSave } from './use-lyric-editor-document';

// Identity-based save pipeline: blocks map to slides by id, so a no-op edit
// must produce zero mutations, a reorder must issue only the moves required
// to reach the target order, and an empty block must never destroy its slide.

const mocks = vi.hoisted(() => ({
  cast: {
    mutatePatch: null as unknown,
    runOperation: null as unknown,
    setStatusText: null as unknown,
  },
  navigation: { value: null as unknown },
  slidesContext: { value: null as unknown },
  project: { value: null as unknown },
}));

vi.mock('../../contexts/app-context', () => ({
  useCast: () => ({
    mutatePatch: mocks.cast.mutatePatch,
    runOperation: mocks.cast.runOperation,
    setStatusText: mocks.cast.setStatusText,
  }),
}));

vi.mock('../../contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('../../contexts/slide-context', () => ({
  useSlides: () => mocks.slidesContext.value,
}));

vi.mock('../../contexts/use-project-content', () => ({
  useProjectContent: () => mocks.project.value,
}));

// ─── Fixtures ────────────────────────────────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z';

function makeSlide(id: Id, order: number): Slide {
  return {
    id,
    backgroundSource: 'local',
    presentationId: null,
    lyricId: 'lyric-1',
    talkId: null,
    presentationThemeId: null,
    lyricThemeId: null,
    talkThemeId: null,
    overlayThemeId: null,
    overlayId: null,
    stageId: null,
    kind: 'lyric',
    width: 1920,
    height: 1080,
    notes: '',
    order,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeTextElement(id: Id, slideId: Id, text: string): SlideElement {
  return {
    id,
    slideId,
    type: 'text',
    x: 180,
    y: 860,
    width: 1560,
    height: 170,
    rotation: 0,
    opacity: 1,
    zIndex: 20,
    layer: 'content',
    payload: {
      text,
      fontFamily: 'Arial',
      fontSize: 81,
      color: '#FFFFFF',
      alignment: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      caseTransform: 'none',
      weight: '700',
      visible: true,
      locked: false,
      fillEnabled: false,
      fillColor: '#00000000',
      strokeEnabled: false,
      shadowEnabled: false,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface HarnessSnapshot {
  slides: Slide[];
  slideElements: SlideElement[];
}

interface RecordedCall {
  method: string;
  args: unknown;
}

function setupHarness(initial: HarnessSnapshot) {
  const snapshotRef = { current: initial };
  const calls: RecordedCall[] = [];
  let createdCount = 0;

  const applyToSnapshot = (mutate: (snapshot: HarnessSnapshot) => HarnessSnapshot) => {
    snapshotRef.current = mutate(snapshotRef.current);
  };

  const castApi = {
    createSlide: async (input: { lyricId: Id }) => {
      calls.push({ method: 'createSlide', args: input });
      createdCount += 1;
      const id = `created-${createdCount}` as Id;
      const maxOrder = snapshotRef.current.slides.reduce((max, slide) => Math.max(max, slide.order), -1);
      applyToSnapshot((snapshot) => ({
        ...snapshot,
        slides: [...snapshot.slides, makeSlide(id, maxOrder + 1)],
        // The store seeds a placeholder lyric text element on every new slide.
        slideElements: [...snapshot.slideElements, makeTextElement(`${id}-text` as Id, id, 'Verse line one\nVerse line two')],
      }));
      return {} as SnapshotPatch;
    },
    updateElementsBatch: async (inputs: Array<{ id: Id; payload?: Record<string, unknown> }>) => {
      calls.push({ method: 'updateElementsBatch', args: inputs });
      applyToSnapshot((snapshot) => ({
        ...snapshot,
        slideElements: snapshot.slideElements.map((element) => {
          const update = inputs.find((input) => input.id === element.id);
          return update ? { ...element, payload: { ...element.payload, ...update.payload } } : element;
        }),
      }));
      return {} as SnapshotPatch;
    },
    createElementsBatch: async (inputs: unknown[]) => {
      calls.push({ method: 'createElementsBatch', args: inputs });
      return {} as SnapshotPatch;
    },
    deleteSlide: async (slideId: Id) => {
      calls.push({ method: 'deleteSlide', args: slideId });
      applyToSnapshot((snapshot) => ({
        ...snapshot,
        slides: snapshot.slides.filter((slide) => slide.id !== slideId),
        slideElements: snapshot.slideElements.filter((element) => element.slideId !== slideId),
      }));
      return {} as SnapshotPatch;
    },
    setSlideOrder: async (input: { slideId: Id; newOrder: number }) => {
      calls.push({ method: 'setSlideOrder', args: input });
      applyToSnapshot((snapshot) => ({
        ...snapshot,
        slides: (() => {
          const ordered = [...snapshot.slides].sort((left, right) => left.order - right.order);
          const currentIndex = ordered.findIndex((slide) => slide.id === input.slideId);
          if (currentIndex < 0) return snapshot.slides;
          const [moved] = ordered.splice(currentIndex, 1);
          ordered.splice(Math.max(0, Math.min(input.newOrder, ordered.length)), 0, moved);
          return ordered.map((slide, order) => ({ ...slide, order }));
        })(),
      }));
      return {} as SnapshotPatch;
    },
  };
  (window as unknown as { castApi: unknown }).castApi = castApi;

  mocks.cast.mutatePatch = async (action: () => Promise<SnapshotPatch>) => {
    await action();
    return snapshotRef.current;
  };
  mocks.cast.runOperation = async (_text: string, action: () => Promise<unknown>) => action();
  mocks.cast.setStatusText = vi.fn();

  mocks.navigation.value = {
    currentItem: { id: 'lyric-1' },
    currentItemRef: { type: 'lyric', id: 'lyric-1' },
  };

  const orderedSlides = [...snapshotRef.current.slides].sort((left, right) => left.order - right.order);
  mocks.slidesContext.value = { slides: orderedSlides };

  const elementsBySlide = new Map<Id, SlideElement[]>();
  for (const element of snapshotRef.current.slideElements) {
    elementsBySlide.set(element.slideId, [...elementsBySlide.get(element.slideId) ?? [], element]);
  }
  mocks.project.value = { slideElementsBySlideId: elementsBySlide };

  return { calls, snapshotRef };
}

function renderSaveHook(onClose: () => void) {
  return renderHook(() => useLyricEditorSave({
    isOpen: true,
    onClose,
    config: {
      boxWidth: 1767,
      boxHeight: 210,
      fontFamily: 'Arial',
      fontWeight: '700',
      fontSize: 81,
      lineHeight: 1.2,
      segmentsPerSlide: 1,
    },
  }));
}

afterEach(() => {
  cleanup();
});

describe('useLyricEditorSave', () => {
  it('performs zero mutations when saving unedited blocks', async () => {
    const { calls } = setupHarness({
      slides: [makeSlide('s1', 0), makeSlide('s2', 1)],
      slideElements: [
        makeTextElement('e1', 's1', 'First'),
        makeTextElement('e2', 's2', 'Second'),
      ],
    });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([
        { id: 's1', content: 'First' },
        { id: 's2', content: 'Second' },
      ]);
    });

    expect(calls).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.cast.setStatusText).toHaveBeenCalledWith('Saved lyrics');
  });

  it('reorder-only save calls setSlideOrder and nothing else', async () => {
    const { calls, snapshotRef } = setupHarness({
      slides: [makeSlide('s1', 0), makeSlide('s2', 1)],
      slideElements: [
        makeTextElement('e1', 's1', 'First'),
        makeTextElement('e2', 's2', 'Second'),
      ],
    });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([
        { id: 's2', content: 'Second' },
        { id: 's1', content: 'First' },
      ]);
    });

    expect(calls).toEqual([
      { method: 'setSlideOrder', args: { slideId: 's2', newOrder: 0 } },
    ]);
    const finalOrder = [...snapshotRef.current.slides]
      .sort((left, right) => left.order - right.order)
      .map((slide) => slide.id);
    expect(finalOrder).toEqual(['s2', 's1']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates one slide per unknown id in a single save and orders them in block order', async () => {
    const { calls, snapshotRef } = setupHarness({
      slides: [makeSlide('s1', 0)],
      slideElements: [makeTextElement('e1', 's1', 'First')],
    });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([
        { id: 's1', content: 'First' },
        { id: 'new-a', content: 'Alpha' },
        { id: 'new-b', content: 'Beta' },
      ]);
    });

    const methods = calls.map((call) => call.method);
    expect(methods.filter((method) => method === 'createSlide')).toHaveLength(2);
    expect(methods).not.toContain('deleteSlide');

    // Each created slide's seeded placeholder element must be overwritten
    // with its own block's content — the detection loop must not resolve two
    // unknown blocks to the same created slide.
    const updates = (calls.find((call) => call.method === 'updateElementsBatch') as RecordedCall).args as Array<{ id: Id; payload: { text: string } }>;
    expect(updates.find((update) => update.id === 'created-1-text')?.payload.text).toBe('Alpha');
    expect(updates.find((update) => update.id === 'created-2-text')?.payload.text).toBe('Beta');

    const orderCalls = calls.filter((call) => call.method === 'setSlideOrder');
    expect(orderCalls).toEqual([]);
    const finalOrder = [...snapshotRef.current.slides]
      .sort((left, right) => left.order - right.order)
      .map((slide) => slide.id);
    expect(finalOrder).toEqual(['s1', 'created-1', 'created-2']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an empty block preserves a media-only slide untouched', async () => {
    const { calls } = setupHarness({
      slides: [makeSlide('media-only', 0)],
      slideElements: [],
    });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([{ id: 'media-only', content: '' }]);
    });

    expect(calls).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes an empty string into the text element of an emptied block, keeping styling', async () => {
    const { calls } = setupHarness({
      slides: [makeSlide('s1', 0)],
      slideElements: [makeTextElement('e1', 's1', 'First')],
    });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([{ id: 's1', content: '   ' }]);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('updateElementsBatch');
    const updates = calls[0].args as Array<{ id: Id; payload: Record<string, unknown> }>;
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('e1');
    expect(updates[0].payload.text).toBe('');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates slides for unknown ids and deletes slides whose ids disappeared', async () => {
    const { calls, snapshotRef } = setupHarness({
      slides: [makeSlide('s1', 0), makeSlide('gone', 1)],
      slideElements: [makeTextElement('e1', 's1', 'First')],
    });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([
        { id: 's1', content: 'First rewritten' },
        { id: 'brand-new', content: 'Second' },
      ]);
    });

    const methods = calls.map((call) => call.method);
    expect(methods).toContain('createSlide');
    expect(methods).toContain('updateElementsBatch');
    expect(methods).toContain('deleteSlide');
    expect(methods.filter((method) => method === 'deleteSlide')).toHaveLength(1);
    expect((calls.find((call) => call.method === 'deleteSlide') as RecordedCall).args).toBe('gone');

    const updates = (calls.find((call) => call.method === 'updateElementsBatch') as RecordedCall).args as Array<{ id: Id; payload: { text: string } }>;
    const firstUpdate = updates.find((update) => update.id === 'e1');
    expect(firstUpdate?.payload.text).toBe('First rewritten');
    const seededUpdate = updates.find((update) => update.id === 'created-1-text');
    expect(seededUpdate?.payload.text).toBe('Second');

    const createdSlide = snapshotRef.current.slides.find((slide) => slide.id === 'created-1');
    expect(createdSlide).toBeDefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates a slide for the seeded empty block of a lyric with zero slides', async () => {
    const { calls, snapshotRef } = setupHarness({ slides: [], slideElements: [] });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([{ id: 'seeded-empty', content: '' }]);
    });

    expect(calls.map((call) => call.method)).toEqual(['createSlide', 'updateElementsBatch']);
    const seededElement = snapshotRef.current.slideElements.find((element) => element.id === 'created-1-text');
    expect((seededElement?.payload as { text?: string }).text).toBe('');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves only a newly created slide that belongs between existing slides', async () => {
    const { calls, snapshotRef } = setupHarness({
      slides: [makeSlide('s1', 0), makeSlide('s2', 1)],
      slideElements: [
        makeTextElement('e1', 's1', 'First'),
        makeTextElement('e2', 's2', 'Second'),
      ],
    });
    const onClose = vi.fn();
    const { result } = renderSaveHook(onClose);

    await act(async () => {
      await result.current.saveBlocks([
        { id: 's1', content: 'First' },
        { id: 'new-middle', content: 'Middle' },
        { id: 's2', content: 'Second' },
      ]);
    });

    expect(calls.filter((call) => call.method === 'setSlideOrder')).toEqual([
      { method: 'setSlideOrder', args: { slideId: 'created-1', newOrder: 1 } },
    ]);
    expect([...snapshotRef.current.slides]
      .sort((left, right) => left.order - right.order)
      .map((slide) => slide.id)).toEqual(['s1', 'created-1', 's2']);
  });
});

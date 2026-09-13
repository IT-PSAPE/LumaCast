import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATION_TRIGGER_EVENT, type AutomationTriggerEventDetail } from '@lumacast/automation';
import type { PlaylistItemEntry } from '@lumacast/composition';
import type { Slide } from '@lumacast/composition';
import { SlideProvider, useSlides } from '../../../../app/renderer/contexts/slide-context';

type SlidesCtx = ReturnType<typeof useSlides>;

const ITEM_REF = { type: 'presentation', id: 'item1' } as const;

const mocks = vi.hoisted(() => ({
  mutatePatch: vi.fn(async (action: () => Promise<unknown>) => action()),
  runOperation: vi.fn(async (_text: string, action: () => Promise<unknown>) => action()),
  setStatusText: vi.fn(),
  currentItemRef: null as unknown as { type: string; id: string } | null,
  currentPlaylistEntryId: null as string | null,
  currentPlaylistItemRef: null as unknown as { type: string; id: string } | null,
  currentPlaylistRows: [] as PlaylistItemEntry[],
  currentOutputPlaylistEntryId: null as string | null,
  currentOutputItemRef: null as unknown as { type: string; id: string } | null,
  isDetachedDeckBrowser: false,
  armOutputPlaylistEntry: vi.fn(),
  armOutputItem: vi.fn(),
  slides: [] as Slide[],
}));

vi.mock('../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => ({
    mutatePatch: mocks.mutatePatch,
    runOperation: mocks.runOperation,
    setStatusText: mocks.setStatusText,
  }),
}));

vi.mock('../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({
    currentItemRef: mocks.currentItemRef,
    currentPlaylistEntryId: mocks.currentPlaylistEntryId,
    currentPlaylistItemRef: mocks.currentPlaylistItemRef,
    currentPlaylistRows: mocks.currentPlaylistRows,
    currentOutputPlaylistEntryId: mocks.currentOutputPlaylistEntryId,
    currentOutputItemRef: mocks.currentOutputItemRef,
    isDetachedDeckBrowser: mocks.isDetachedDeckBrowser,
    armOutputPlaylistEntry: mocks.armOutputPlaylistEntry,
    armOutputItem: mocks.armOutputItem,
    selectPlaylistEntry: vi.fn(),
    selectPlaylistItem: vi.fn(),
  }),
}));

vi.mock('../../../../app/renderer/contexts/use-project-content', () => ({
  itemRefKey: (ref: { type: string; id: string }) => `${ref.type}:${ref.id}`,
  useProjectContent: () => ({
    slidesForItemRef: () => mocks.slides,
    liveSlideElementsBySlideId: new Map(),
  }),
}));

function itemRow(id: string, itemId: string): PlaylistItemEntry {
  return {
    id,
    playlistId: 'pl',
    kind: 'item',
    reference: { type: 'presentation', itemId },
    presentationId: itemId,
    lyricId: null,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeSlides(): Slide[] {
  return [{ id: 's1' }, { id: 's2' }] as unknown as Slide[];
}

let activateScheduledSlide: ((itemRef: typeof ITEM_REF, slideId: string) => void) | null = null;
let slidesCtx: SlidesCtx | null = null;

function Probe() {
  const ctx = useSlides();
  activateScheduledSlide = ctx.activateScheduledSlide;
  slidesCtx = ctx;
  return null;
}

function Harness() {
  return (
    <SlideProvider>
      <Probe />
    </SlideProvider>
  );
}

let seen: AutomationTriggerEventDetail[] = [];

beforeEach(() => {
  cleanup();
  seen = [];
  activateScheduledSlide = null;
  slidesCtx = null;
  mocks.mutatePatch.mockClear();
  mocks.runOperation.mockClear();
  mocks.setStatusText.mockClear();
  mocks.armOutputPlaylistEntry.mockClear();
  mocks.armOutputItem.mockClear();
  mocks.currentItemRef = null;
  mocks.currentPlaylistEntryId = null;
  mocks.currentPlaylistItemRef = null;
  mocks.currentPlaylistRows = [];
  mocks.currentOutputPlaylistEntryId = null;
  mocks.currentOutputItemRef = null;
  mocks.isDetachedDeckBrowser = false;
  mocks.slides = makeSlides();
  window.addEventListener(AUTOMATION_TRIGGER_EVENT, onTrigger);
});

afterEach(() => {
  cleanup();
  window.removeEventListener(AUTOMATION_TRIGGER_EVENT, onTrigger);
  vi.restoreAllMocks();
});

function onTrigger(event: Event) {
  seen.push((event as CustomEvent<AutomationTriggerEventDetail>).detail);
}

function triggerTypes() {
  return seen.map((detail) => detail.triggerType);
}

describe('SlideProvider activateScheduledSlide', () => {
  it('keeps the current matching playlist row when the item occurs twice and emits activate/take once', () => {
    mocks.currentPlaylistRows = [itemRow('entry-a', 'item1'), itemRow('entry-b', 'item1')];
    mocks.currentOutputPlaylistEntryId = 'entry-b';
    mocks.currentOutputItemRef = { ...ITEM_REF } as any;
    render(<Harness />);
    expect(activateScheduledSlide).not.toBeNull();

    act(() => { activateScheduledSlide?.(ITEM_REF, 's2'); });

    expect(mocks.armOutputPlaylistEntry).toHaveBeenCalledTimes(1);
    expect(mocks.armOutputPlaylistEntry).toHaveBeenCalledWith('entry-b');
    expect(mocks.armOutputItem).not.toHaveBeenCalled();
    expect(triggerTypes()).toEqual(['slide.activate', 'slide.take']);
    expect(seen.every((detail) => detail.sourceId === 's2')).toBe(true);
  });

  it('falls back to the first match when output points at another entry', () => {
    mocks.currentPlaylistRows = [itemRow('entry-a', 'item1'), itemRow('entry-b', 'item1')];
    mocks.currentOutputPlaylistEntryId = 'entry-other';
    mocks.currentOutputItemRef = { type: 'lyric', id: 'song9' } as any;
    render(<Harness />);

    act(() => { activateScheduledSlide?.(ITEM_REF, 's1'); });

    expect(mocks.armOutputPlaylistEntry).toHaveBeenCalledWith('entry-a');
    expect(triggerTypes()).toEqual(['slide.activate', 'slide.take']);
    expect(seen.every((detail) => detail.sourceId === 's1')).toBe(true);
  });

  it('arms the bare item directly when no playlist row references it', () => {
    mocks.currentPlaylistRows = [];
    mocks.currentOutputPlaylistEntryId = null;
    mocks.currentOutputItemRef = { ...ITEM_REF } as any;
    render(<Harness />);

    act(() => { activateScheduledSlide?.(ITEM_REF, 's1'); });

    expect(mocks.armOutputPlaylistEntry).not.toHaveBeenCalled();
    expect(mocks.armOutputItem).toHaveBeenCalledWith(ITEM_REF);
    expect(triggerTypes()).toEqual(['slide.activate', 'slide.take']);
  });

  it('does nothing for an unknown slide id', () => {
    mocks.currentPlaylistRows = [itemRow('entry-a', 'item1')];
    mocks.currentOutputPlaylistEntryId = 'entry-a';
    mocks.currentOutputItemRef = { ...ITEM_REF } as any;
    render(<Harness />);

    act(() => { activateScheduledSlide?.(ITEM_REF, 'missing'); });

    expect(mocks.armOutputPlaylistEntry).not.toHaveBeenCalled();
    expect(mocks.armOutputItem).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});

// Regression coverage for the "Take is silently inert while browsing a
// detached item" defect: browsing an item opened from the Deck bin
// (isDetachedDeckBrowser=true) has no playlist entry to drive output through,
// so activateSlide/takeSlide must fall back to arming the output item
// directly — the same fallback activateScheduledSlide already used above.
describe('SlideProvider activateSlide/takeSlide — detached Deck-bin browsing', () => {
  it('activateSlide arms the output item directly when browsing a detached item', () => {
    mocks.isDetachedDeckBrowser = true;
    mocks.currentItemRef = { ...ITEM_REF } as any;
    render(<Harness />);
    expect(slidesCtx).not.toBeNull();

    act(() => { slidesCtx?.activateSlide(1); });

    expect(mocks.armOutputItem).toHaveBeenCalledWith(ITEM_REF);
    expect(mocks.armOutputPlaylistEntry).not.toHaveBeenCalled();
    expect(triggerTypes()).toEqual(['slide.activate']);
  });

  it('takeSlide arms the output item directly when browsing a detached item', () => {
    mocks.isDetachedDeckBrowser = true;
    mocks.currentItemRef = { ...ITEM_REF } as any;
    render(<Harness />);

    act(() => { slidesCtx?.setCurrentSlideIndex(1); });
    act(() => { slidesCtx?.takeSlide(); });

    expect(mocks.armOutputItem).toHaveBeenCalledWith(ITEM_REF);
    expect(mocks.armOutputPlaylistEntry).not.toHaveBeenCalled();
    expect(triggerTypes()).toEqual(['slide.activate', 'slide.take']);
  });

  it('still does nothing when not detached and the playlist selection is unresolved', () => {
    // Regression guard: outside the detached-browser case, an unresolved
    // playlist selection must keep behaving exactly as before this fix —
    // the browse index still moves (selectionKey path), but nothing arms.
    mocks.isDetachedDeckBrowser = false;
    mocks.currentItemRef = { ...ITEM_REF } as any;
    mocks.currentPlaylistItemRef = null;
    mocks.currentPlaylistEntryId = null;
    render(<Harness />);

    act(() => { slidesCtx?.activateSlide(1); });
    act(() => { slidesCtx?.takeSlide(); });

    expect(mocks.armOutputItem).not.toHaveBeenCalled();
    expect(mocks.armOutputPlaylistEntry).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});

// Regression coverage for "Next/Previous slide behave differently from
// keyboard vs menu": goNext/goPrev now make the armed-vs-browse decision
// themselves, so both the keyboard shortcut and the app-menu command (which
// both call these same methods) share one behaviour.
describe('SlideProvider goNext/goPrev — shared armed-vs-browse decision', () => {
  function armPlaylistScenario(armed: boolean) {
    mocks.currentItemRef = { ...ITEM_REF } as any;
    mocks.currentPlaylistItemRef = { ...ITEM_REF } as any;
    mocks.currentPlaylistEntryId = 'entry-a';
    mocks.currentOutputPlaylistEntryId = armed ? 'entry-a' : 'entry-other';
    mocks.currentOutputItemRef = armed ? ({ ...ITEM_REF } as any) : ({ type: 'lyric', id: 'other' } as any);
  }

  it('goNext arms the next slide when output is already armed on the current entry', () => {
    armPlaylistScenario(true);
    render(<Harness />);
    act(() => { slidesCtx?.setCurrentSlideIndex(0); });
    expect(slidesCtx?.isOutputArmedOnCurrent).toBe(true);

    act(() => { slidesCtx?.goNext(); });

    expect(mocks.armOutputPlaylistEntry).toHaveBeenCalledWith('entry-a');
    expect(slidesCtx?.currentSlideIndex).toBe(1);
  });

  it('goNext only moves the browse cursor (no arming) when output is not armed on the current entry', () => {
    armPlaylistScenario(false);
    render(<Harness />);
    act(() => { slidesCtx?.setCurrentSlideIndex(0); });
    expect(slidesCtx?.isOutputArmedOnCurrent).toBe(false);

    act(() => { slidesCtx?.goNext(); });

    expect(mocks.armOutputPlaylistEntry).not.toHaveBeenCalled();
    expect(slidesCtx?.currentSlideIndex).toBe(1);
  });

  it('goPrev only moves the browse cursor (no arming) when output is not armed on the current entry', () => {
    armPlaylistScenario(false);
    render(<Harness />);
    act(() => { slidesCtx?.setCurrentSlideIndex(1); });

    act(() => { slidesCtx?.goPrev(); });

    expect(mocks.armOutputPlaylistEntry).not.toHaveBeenCalled();
    expect(slidesCtx?.currentSlideIndex).toBe(0);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LyricTrack } from '../../../../../../apps/chord/renderer/features/timeline/lyric-track';
import { createTestProject, createTestStore, type TestChordStore } from '../../test-store';
import type { ChordCue } from '../../../../../../apps/chord/shared/project';

// `useChordStore` is replaced with a lookup against this mutable box, so each
// test can point it at a differently-shaped `createTestStore(...)` snapshot.
// The box itself is created inline (no external calls) so it is safe to
// reference from the hoisted `vi.mock` factory below.
const box = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(box.store),
    { getState: () => box.store },
  ),
}));

// jsdom ships a real `PointerEvent` but no pointer-capture API, and
// `LyricTrack` calls `setPointerCapture`/`releasePointerCapture`/
// `hasPointerCapture` on every drag interaction. Stub only what is missing,
// and restore it afterwards (mirrors packages/ui/src/panel-resize.test.tsx).
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;

beforeAll(() => {
  if (typeof originalSetPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (typeof originalReleasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
  if (typeof originalHasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
});

afterAll(() => {
  if (originalSetPointerCapture) Element.prototype.setPointerCapture = originalSetPointerCapture;
  else delete (Element.prototype as { setPointerCapture?: unknown }).setPointerCapture;
  if (originalReleasePointerCapture) Element.prototype.releasePointerCapture = originalReleasePointerCapture;
  else delete (Element.prototype as { releasePointerCapture?: unknown }).releasePointerCapture;
  if (originalHasPointerCapture) Element.prototype.hasPointerCapture = originalHasPointerCapture;
  else delete (Element.prototype as { hasPointerCapture?: unknown }).hasPointerCapture;
});

afterEach(cleanup);

function cue(overrides: Partial<ChordCue> & { id: string; startMs: number }): ChordCue {
  return { endMs: null, text: 'Lyric line', override: null, ...overrides };
}

function setStore(overrides: Partial<TestChordStore> = {}): TestChordStore {
  const store = createTestStore(overrides);
  box.store = store as unknown as Record<string, unknown>;
  return store;
}

describe('LyricTrack', () => {
  it('positions each clip from its start to its effective end, per the current zoom and scroll', () => {
    const a = cue({ id: 'a', startMs: 2000, endMs: 4000, text: 'First line' });
    setStore({
      document: { project: createTestProject({ cues: [a] }), path: null },
      timeline: { zoom: 100, scrollMs: 1000, viewportWidth: 800 },
    });

    render(<LyricTrack />);

    const clip = screen.getByText('First line').closest('div[style]') as HTMLElement;
    expect(clip.style.left).toBe('100px'); // (2000 - 1000)ms @ 100px/s
    expect(clip.style.width).toBe('200px'); // (4000 - 2000)ms @ 100px/s
  });

  it('re-positions clips when zoom or scroll changes', () => {
    const a = cue({ id: 'a', startMs: 2000, endMs: 4000, text: 'First line' });
    setStore({
      document: { project: createTestProject({ cues: [a] }), path: null },
      timeline: { zoom: 50, scrollMs: 0, viewportWidth: 800 },
    });

    render(<LyricTrack />);

    const clip = screen.getByText('First line').closest('div[style]') as HTMLElement;
    expect(clip.style.left).toBe('100px'); // 2000ms @ 50px/s
    expect(clip.style.width).toBe('100px'); // 2000ms @ 50px/s
  });

  it('renders a detached marker only for a cue with a non-null override', () => {
    const linked = cue({ id: 'linked', startMs: 0, endMs: 1000, text: 'Linked line' });
    const detached = cue({ id: 'detached', startMs: 1000, endMs: 2000, text: 'Detached line', override: {} });
    setStore({
      document: { project: createTestProject({ cues: [linked, detached] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
    });

    render(<LyricTrack />);

    const linkedClip = screen.getByText('Linked line').closest('div[style]') as HTMLElement;
    const detachedClip = screen.getByText('Detached line').closest('div[style]') as HTMLElement;
    expect(linkedClip.querySelector('[aria-label="Detached from theme"]')).toBeNull();
    expect(detachedClip.querySelector('[aria-label="Detached from theme"]')).not.toBeNull();
  });

  it('clicking a clip resolves selection through the shared controlled transition', () => {
    const a = cue({ id: 'a', startMs: 0, endMs: 1000, text: 'First' });
    const b = cue({ id: 'b', startMs: 1000, endMs: 2000, text: 'Second' });
    const store = setStore({
      document: { project: createTestProject({ cues: [a, b] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
      selection: ['b'],
    });

    render(<LyricTrack />);
    fireEvent.pointerDown(screen.getByText('First'), { pointerId: 1, clientX: 10 });

    expect(store.selectFromInteraction).toHaveBeenCalledWith(['a', 'b'], 'a', {
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
    });
  });

  it('shift-clicking a clip resolves an inclusive range from the anchor', () => {
    const a = cue({ id: 'a', startMs: 0, endMs: 1000, text: 'First' });
    const b = cue({ id: 'b', startMs: 1000, endMs: 2000, text: 'Second' });
    const store = setStore({
      document: { project: createTestProject({ cues: [a, b] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
      selection: ['b'],
      tool: 'tap',
    });

    render(<LyricTrack />);
    fireEvent.pointerDown(screen.getByText('First'), { pointerId: 1, clientX: 10, shiftKey: true });

    expect(store.selectFromInteraction).toHaveBeenCalledWith(['a', 'b'], 'a', {
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
    });
    expect(store.seek).not.toHaveBeenCalled();
    expect(store.tapMark).not.toHaveBeenCalled();
    expect(store.togglePlay).not.toHaveBeenCalled();
  });

  it('cmd/ctrl-clicking a clip toggles it in the selection', () => {
    const a = cue({ id: 'a', startMs: 0, endMs: 1000, text: 'First' });
    const store = setStore({
      document: { project: createTestProject({ cues: [a] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
      selection: ['a'],
    });

    render(<LyricTrack />);
    fireEvent.pointerDown(screen.getByText('First'), { pointerId: 1, clientX: 10, metaKey: true });

    expect(store.selectFromInteraction).toHaveBeenCalledWith(['a'], 'a', {
      shiftKey: false,
      metaKey: true,
      ctrlKey: false,
    });
  });

  it('dragging a selected group moves all cues with one shared delta', () => {
    const a = cue({ id: 'a', startMs: 0, endMs: 1000, text: 'First' });
    const b = cue({ id: 'b', startMs: 3000, endMs: 4000, text: 'Second' });
    const store = setStore({
      document: { project: createTestProject({ cues: [a, b] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
      selection: ['a', 'b'],
    });

    render(<LyricTrack />);
    fireEvent.pointerDown(screen.getByText('First'), { pointerId: 1, clientX: 10 });
    const content = document.querySelector('[data-ui-region="lyric-track"]')?.children[1] as HTMLElement;
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 110 });
    fireEvent.pointerUp(content, { pointerId: 1, clientX: 110 });

    expect(store.moveCues).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.moveCues).mock.calls[0]?.[0]).toEqual(['a', 'b']);
    expect(vi.mocked(store.moveCues).mock.calls[0]?.[1]).toBeCloseTo(1000);
    expect(store.beginTransaction).toHaveBeenCalledWith('Move 2 cues');
    expect(store.endTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not move a cue that a modifier-click just removed from the selection', () => {
    const a = cue({ id: 'a', startMs: 0, endMs: 1000, text: 'First' });
    const b = cue({ id: 'b', startMs: 3000, endMs: 4000, text: 'Second' });
    const store = setStore({
      document: { project: createTestProject({ cues: [a, b] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
      selection: ['a', 'b'],
      selectFromInteraction: vi.fn(() => ['a']),
    });

    render(<LyricTrack />);
    fireEvent.pointerDown(screen.getByText('Second'), { pointerId: 1, clientX: 310, ctrlKey: true });
    const content = document.querySelector('[data-ui-region="lyric-track"]')?.children[1] as HTMLElement;
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 410 });
    fireEvent.pointerUp(content, { pointerId: 1, clientX: 410 });

    expect(store.moveCues).not.toHaveBeenCalled();
    expect(store.beginTransaction).not.toHaveBeenCalled();
    expect(store.endTransaction).not.toHaveBeenCalled();
  });

  it('double-clicking a clip selects it and switches the inspector to the cue tab', () => {
    const a = cue({ id: 'a', startMs: 0, endMs: 1000, text: 'First' });
    const store = setStore({
      document: { project: createTestProject({ cues: [a] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
    });

    render(<LyricTrack />);
    fireEvent.doubleClick(screen.getByText('First'));

    expect(store.selectFromInteraction).toHaveBeenCalledWith(['a'], 'a');
    expect(store.setInspectorTab).toHaveBeenCalledWith('cue');
  });

  it('clicking empty track space clears the selection and seeks there', () => {
    const store = setStore({
      document: { project: createTestProject({ cues: [] }), path: null },
      timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 },
      selection: ['a'],
    });

    render(<LyricTrack />);
    const track = screen.getByText('No cues yet').parentElement as HTMLElement;
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 50 });
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 50 });

    expect(store.clearSelection).toHaveBeenCalled();
    expect(store.seek).toHaveBeenCalledWith(500); // 50px @ 100px/s
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LyricTrack } from '../../../../../../apps/chord/renderer/features/timeline/lyric-track';
import { useTimelineShortcuts } from '../../../../../../apps/chord/renderer/features/timeline/use-timeline-shortcuts';
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
  it('shows one actionable empty state and removes it when a cue exists', () => {
    setStore({ document: { project: createTestProject({ cues: [] }), path: null } });
    const { rerender } = render(<LyricTrack />);

    expect(screen.getByText('Drop a lyric file, or add a cue')).toBeVisible();
    expect(screen.queryByText('No cues yet')).toBeNull();

    setStore({
      document: { project: createTestProject({ cues: [cue({ id: 'first', startMs: 0 })] }), path: null },
    });
    rerender(<LyricTrack />);

    expect(screen.queryByText('Drop a lyric file, or add a cue')).toBeNull();
    expect(screen.getByText('Lyric line')).toBeVisible();
  });

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
    const track = screen.getByText('Drop a lyric file, or add a cue').parentElement as HTMLElement;
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 50 });
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 50 });

    expect(store.clearSelection).toHaveBeenCalled();
    expect(store.seek).toHaveBeenCalledWith(500); // 50px @ 100px/s
  });

  describe('keyboard cue selection', () => {
    const cues = [cue({ id: 'a', startMs: 0, endMs: 1000, text: 'First' }), cue({ id: 'b', startMs: 2000, endMs: 3000, text: 'Second' }), cue({ id: 'c', startMs: 30000, endMs: 32000, text: 'First' })];
    const project = () => createTestProject({ cues });

    it('exposes a horizontal multi-select listbox with one roving option tab stop', () => {
      setStore({ document: { project: project(), path: null }, selection: ['b'] });
      render(<LyricTrack />);
      const list = screen.getByRole('listbox', { name: 'Lyric cues' });
      expect(list).toHaveAttribute('aria-orientation', 'horizontal');
      expect(list).toHaveAttribute('aria-multiselectable', 'true');
      const options = screen.getAllByRole('option');
      expect(options.filter((option) => option.tabIndex === 0)).toEqual([options[1]]);
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      expect(options[0]).toHaveAccessibleName('Cue 1, 00:00:00: First');
      expect(options[2]).toHaveAccessibleName('Cue 3, 00:30:00: First');
    });

    it('navigates focus locally without selecting, seeking or stepping transport', () => {
      const store = setStore({ document: { project: project(), path: null } });
      function TrackWithShortcuts() { useTimelineShortcuts(); return <LyricTrack />; }
      render(<TrackWithShortcuts />);
      const options = screen.getAllByRole('option');
      options[0].focus();
      fireEvent.keyDown(options[0], { key: 'ArrowRight' });
      expect(options[1]).toHaveFocus();
      fireEvent.keyDown(options[1], { key: 'End' });
      expect(options[2]).toHaveFocus();
      fireEvent.keyDown(options[2], { key: 'Home' });
      expect(options[0]).toHaveFocus();
      fireEvent.keyDown(options[0], { key: 'ArrowLeft' });
      expect(options[0]).toHaveFocus();
      expect(store.selectFromInteraction).not.toHaveBeenCalled();
      expect(store.seek).not.toHaveBeenCalled();
      expect(store.stepFrames).not.toHaveBeenCalled();
      fireEvent.keyDown(options[0], { key: 'ArrowDown' });
      expect(store.seek).toHaveBeenCalledWith(2000);
    });

    it('leaves Escape and Tab to the transport and normal focus routing', () => {
      const store = setStore({ document: { project: project(), path: null }, selection: ['a'] });
      function TrackWithShortcuts() { useTimelineShortcuts(); return <LyricTrack />; }
      render(<TrackWithShortcuts />);
      const option = screen.getAllByRole('option')[0];
      option.focus();
      fireEvent.keyDown(option, { key: 'Escape' });
      expect(store.clearSelection).toHaveBeenCalledOnce();
      expect(option).toHaveFocus();
      expect(fireEvent.keyDown(option, { key: 'Tab' })).toBe(true);
    });

    it.each([
      {}, { shiftKey: true }, { ctrlKey: true }, { metaKey: true },
    ])('selects through the controlled resolver with Space modifiers %o', (modifiers) => {
      const store = setStore({ document: { project: project(), path: null } });
      function TrackWithShortcuts() { useTimelineShortcuts(); return <LyricTrack />; }
      render(<TrackWithShortcuts />);
      const option = screen.getAllByRole('option')[1];
      option.focus();
      fireEvent.keyDown(option, { key: ' ', ...modifiers });
      fireEvent.keyDown(option, { key: ' ', repeat: true, ...modifiers });
      expect(store.selectFromInteraction).toHaveBeenCalledExactlyOnceWith(['a', 'b', 'c'], 'b', { shiftKey: false, metaKey: false, ctrlKey: false, ...modifiers });
      expect(store.togglePlay).not.toHaveBeenCalled();
    });

    it('reveals the rendered width of a tiny final cue and anchors a giant cue at its start', () => {
      const giant = cue({ id: 'giant', startMs: 0, endMs: 60000 });
      const tiny = cue({ id: 'tiny', startMs: 61000, endMs: 61010 });
      const store = setStore({ document: { project: createTestProject({ cues: [giant, tiny] }), path: null }, timeline: { zoom: 100, scrollMs: 20000, viewportWidth: 100 } });
      render(<LyricTrack />);
      const options = screen.getAllByRole('option');
      vi.spyOn(options[1], 'getBoundingClientRect').mockReturnValue({ width: 14 } as DOMRect);
      options[0].focus();
      expect(store.setTimelineView).toHaveBeenLastCalledWith({ scrollMs: 0 });
      fireEvent.keyDown(options[0], { key: 'End' });
      expect(options[1]).toHaveFocus();
      expect(store.setTimelineView).toHaveBeenLastCalledWith({ scrollMs: 60140 });
      expect(options[1].style.width).toBe('4px');
    });

    it.each([
      ['Home', 0, 20000, 0], ['ArrowLeft', 0, 20000, 0],
      ['End', 2, 0, 24000], ['ArrowRight', 2, 0, 24000],
    ] as const)('reveals an already-focused boundary cue on %s after a pan', (key, index, scrollMs, expected) => {
      setStore({ document: { project: project(), path: null }, timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 } });
      const { rerender } = render(<LyricTrack />);
      const option = screen.getAllByRole('option')[index];
      option.focus();
      const store = setStore({ document: { project: project(), path: null }, timeline: { zoom: 100, scrollMs, viewportWidth: 800 } });
      rerender(<LyricTrack />);
      expect(option).toHaveFocus();
      fireEvent.keyDown(option, { key });
      expect(option).toHaveFocus();
      expect(store.setTimelineView).toHaveBeenLastCalledWith({ scrollMs: expected });
    });

    it('resets hidden native scrolling and avoids reveal during pointer selection/drag', () => {
      const store = setStore({ document: { project: project(), path: null }, timeline: { zoom: 100, scrollMs: 0, viewportWidth: 800 } });
      render(<LyricTrack />);
      const list = screen.getByRole('listbox');
      const option = screen.getAllByRole('option')[1];
      fireEvent.pointerDown(option, { pointerId: 1, clientX: 210 });
      expect(option).toHaveFocus();
      expect(store.setTimelineView).not.toHaveBeenCalled();
      list.scrollLeft = 120;
      fireEvent.scroll(list);
      expect(list.scrollLeft).toBe(0);
    });

    it('recovers owned focus after deletion, emptying and import', () => {
      setStore({ document: { project: project(), path: null } });
      const { rerender } = render(<LyricTrack />);
      screen.getAllByRole('option')[1].focus();
      setStore({ document: { project: createTestProject({ cues: [cues[0]] }), path: null } });
      rerender(<LyricTrack />);
      expect(screen.getByRole('option')).toHaveFocus();
      setStore({ document: { project: createTestProject({ cues: [] }), path: null } });
      rerender(<LyricTrack />);
      expect(screen.getByRole('listbox')).toHaveFocus();
      setStore({ document: { project: project(), path: null } });
      rerender(<LyricTrack />);
      expect(screen.getAllByRole('option')[0]).toHaveFocus();
    });

    it('does not steal focus from another control when the roved cue disappears', () => {
      setStore({ document: { project: project(), path: null } });
      const { rerender } = render(<><input aria-label="Other editor" /><LyricTrack /></>);
      screen.getAllByRole('option')[1].focus();
      const editor = screen.getByLabelText('Other editor');
      editor.focus();
      setStore({ document: { project: createTestProject({ cues: [cues[0]] }), path: null } });
      rerender(<><input aria-label="Other editor" /><LyricTrack /></>);
      expect(editor).toHaveFocus();
      expect(screen.getByRole('option')).toHaveAttribute('tabindex', '0');
    });

    it('ignores repeated Enter activation', () => {
      const store = setStore({ document: { project: project(), path: null } });
      render(<LyricTrack />);
      fireEvent.keyDown(screen.getAllByRole('option')[0], { key: 'Enter', repeat: true });
      expect(store.selectFromInteraction).not.toHaveBeenCalled();
      expect(store.setInspectorTab).not.toHaveBeenCalled();
    });

    it('activates the focused cue and hands focus to its inspector-owned text field', () => {
      let store: TestChordStore;
      store = setStore({ document: { project: project(), path: null }, selectFromInteraction: vi.fn((_, id) => { store.selection = [id]; return [id]; }) });
      render(<><div data-ui-focus="cue-text" data-cue-id="b"><textarea aria-label="Inspector text target" /></div><LyricTrack /></>);
      const option = screen.getAllByRole('option')[1];
      option.focus();
      fireEvent.keyDown(option, { key: 'Enter' });
      expect(store.selectFromInteraction).toHaveBeenCalledExactlyOnceWith(['a', 'b', 'c'], 'b');
      expect(store.setInspectorTab).toHaveBeenCalledWith('cue');
      expect(screen.getByLabelText('Inspector text target')).toHaveFocus();
    });

    it('cancels an edit focus request after a document session changes', () => {
      let store: TestChordStore;
      store = setStore({ document: { project: project(), path: null }, getDocumentSession: vi.fn().mockReturnValueOnce(0).mockReturnValue(1), selectFromInteraction: vi.fn((_, id) => { store.selection = [id]; return [id]; }) });
      render(<><div data-ui-focus="cue-text" data-cue-id="b"><textarea aria-label="Inspector text target" /></div><LyricTrack /></>);
      const option = screen.getAllByRole('option')[1];
      option.focus();
      fireEvent.keyDown(option, { key: 'Enter' });
      expect(option).toHaveFocus();
    });

    it.each([
      ['a', 'b'], ['b', 'a'],
    ])('keeps focus when editor cue %s or selected cue %s no longer matches the request', (editorId, selectedId) => {
      let store: TestChordStore;
      store = setStore({ document: { project: project(), path: null }, selectFromInteraction: vi.fn(() => { store.selection = [selectedId]; return [selectedId]; }) });
      render(<><div data-ui-focus="cue-text" data-cue-id={editorId}><textarea aria-label="Inspector text target" /></div><LyricTrack /></>);
      const option = screen.getAllByRole('option')[1];
      option.focus();
      fireEvent.keyDown(option, { key: 'Enter' });
      expect(option).toHaveFocus();
    });

    it('does not override a newer focus intent during cue activation', () => {
      let store: TestChordStore;
      store = setStore({ document: { project: project(), path: null }, selectFromInteraction: vi.fn((_, id) => { store.selection = [id]; return [id]; }), setInspectorTab: vi.fn(() => screen.getByLabelText('Other editor').focus()) });
      render(<><input aria-label="Other editor" /><div data-ui-focus="cue-text" data-cue-id="b"><textarea aria-label="Inspector text target" /></div><LyricTrack /></>);
      screen.getAllByRole('option')[1].focus();
      fireEvent.keyDown(screen.getAllByRole('option')[1], { key: 'Enter' });
      expect(screen.getByLabelText('Other editor')).toHaveFocus();
    });
  });
});

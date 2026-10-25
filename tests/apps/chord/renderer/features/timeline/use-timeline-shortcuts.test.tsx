import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestProject, createTestStore, type TestChordStore } from '../../test-store';

let testStore: TestChordStore;

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: Object.assign(
    (selector: (state: TestChordStore) => unknown) => selector(testStore),
    { getState: () => testStore },
  ),
}));

import { useTimelineShortcuts } from '../../../../../../apps/chord/renderer/features/timeline/use-timeline-shortcuts';

function Harness() {
  useTimelineShortcuts();
  return (
    <div>
      <input aria-label="Lyric" />
      <textarea aria-label="Notes" />
      <button type="button">Plain</button>
    </div>
  );
}

function cueStore(overrides: Partial<TestChordStore> = {}): TestChordStore {
  return createTestStore({
    document: {
      project: createTestProject({
        cues: [{ id: 'a', startMs: 1000, endMs: 4000, text: 'Hi', override: null }],
      }),
      path: null,
    },
    selection: ['a'],
    playback: { playing: false, timeMs: 2500, loop: false },
    ...overrides,
  });
}

beforeEach(() => {
  testStore = cueStore();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useTimelineShortcuts: Undo, Redo and Delete ownership', () => {
  it('Cmd+Z undoes and Cmd+Shift+Z redoes when nothing editable has focus', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(testStore.undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Z', metaKey: true, shiftKey: true });
    expect(testStore.redo).toHaveBeenCalledTimes(1);
    expect(testStore.undo).toHaveBeenCalledTimes(1);
  });

  it('plain z does nothing', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'z' });
    expect(testStore.undo).not.toHaveBeenCalled();
  });

  it('typing in a field is not hijacked: undo, redo and delete are left to the field', () => {
    const { getByLabelText } = render(<Harness />);
    for (const field of [getByLabelText('Lyric'), getByLabelText('Notes')]) {
      for (const init of [
        { key: 'z', metaKey: true },
        { key: 'Z', metaKey: true, shiftKey: true },
        { key: 'Delete' },
        { key: 'Backspace' },
        { key: 'd', metaKey: true },
        { key: '[' },
        { key: ']' },
      ]) {
        const notPrevented = fireEvent.keyDown(field, init);
        expect(notPrevented).toBe(true);
      }
    }
    expect(testStore.undo).not.toHaveBeenCalled();
    expect(testStore.redo).not.toHaveBeenCalled();
    expect(testStore.deleteCues).not.toHaveBeenCalled();
    expect(testStore.duplicateCue).not.toHaveBeenCalled();
    expect(testStore.trimCue).not.toHaveBeenCalled();
  });

  it('Delete removes the selection exactly once per keypress', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(testStore.deleteCues).toHaveBeenCalledTimes(1);
    expect(testStore.deleteCues).toHaveBeenCalledWith(['a']);
  });

  it('Delete with no selection does nothing', () => {
    testStore = cueStore({ selection: [] });
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(testStore.deleteCues).not.toHaveBeenCalled();
  });
});

describe('useTimelineShortcuts: cue shortcuts', () => {
  it('Cmd+D duplicates the selected cue to the playhead', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'd', metaKey: true });
    expect(testStore.duplicateCue).toHaveBeenCalledWith('a', 2500);
  });

  it('plain d does nothing', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'd' });
    expect(testStore.duplicateCue).not.toHaveBeenCalled();
  });

  it('[ and ] set the selected cue in and out points at the playhead', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '[' });
    expect(testStore.trimCue).toHaveBeenLastCalledWith('a', 'start', 2500);
    fireEvent.keyDown(window, { key: ']' });
    expect(testStore.trimCue).toHaveBeenLastCalledWith('a', 'end', 2500);
  });

  it('[ and ] do nothing with no selection', () => {
    testStore = cueStore({ selection: [] });
    render(<Harness />);
    fireEvent.keyDown(window, { key: '[' });
    fireEvent.keyDown(window, { key: ']' });
    expect(testStore.trimCue).not.toHaveBeenCalled();
  });
});

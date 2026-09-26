import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestStore, type TestChordStore } from '../../test-store';

let testStore: TestChordStore;

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: (selector: (state: TestChordStore) => unknown) => selector(testStore),
}));

import { Inspector } from '../../../../../../apps/chord/renderer/features/inspector/inspector';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Inspector', () => {
  it('shows the empty state on the Cue tab with nothing selected', () => {
    testStore = createTestStore({ inspectorTab: 'cue', selection: [] });
    render(<Inspector />);
    expect(screen.getByText('Select a lyric on the timeline')).toBeInTheDocument();
  });

  it('detach toggle on the Cue tab calls detachCue for a linked cue', () => {
    const project = createTestStore().document.project;
    testStore = createTestStore({
      inspectorTab: 'cue',
      selection: ['a'],
      document: {
        project: { ...project, cues: [{ id: 'a', startMs: 0, endMs: null, text: 'Hello', override: null }] },
        path: null,
      },
    });
    render(<Inspector />);
    const toggle = screen.getByLabelText('Detach from theme');
    fireEvent.click(toggle);
    expect(testStore.detachCue).toHaveBeenCalledWith('a');
  });

  it('relink toggle on the Cue tab calls relinkCue for a detached cue', () => {
    const project = createTestStore().document.project;
    testStore = createTestStore({
      inspectorTab: 'cue',
      selection: ['a'],
      document: {
        project: { ...project, cues: [{ id: 'a', startMs: 0, endMs: null, text: 'Hello', override: {} }] },
        path: null,
      },
    });
    render(<Inspector />);
    const toggle = screen.getByLabelText('Detach from theme');
    fireEvent.click(toggle);
    expect(testStore.relinkCue).toHaveBeenCalledWith('a');
  });

  it('theme tab edits (font size) call setTheme with the merged text style', () => {
    testStore = createTestStore({ inspectorTab: 'theme' });
    render(<Inspector />);
    const input = screen.getByLabelText('Font size');
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.blur(input);
    expect(testStore.setTheme).toHaveBeenCalledWith({
      text: { ...testStore.document.project.theme.text, fontSize: 80 },
    });
  });

  it('theme tab position quick action ("Center horizontally") calls setTheme', () => {
    testStore = createTestStore({ inspectorTab: 'theme' });
    render(<Inspector />);
    fireEvent.click(screen.getByText('Center horizontally'));
    expect(testStore.setTheme).toHaveBeenCalledTimes(1);
    const [patch] = vi.mocked(testStore.setTheme).mock.calls[0]!;
    expect(patch.box?.x).toBeTypeOf('number');
  });
});

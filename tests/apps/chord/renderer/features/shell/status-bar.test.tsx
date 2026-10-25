import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDocument, createTestStore, type TestChordStore } from '../../test-store';

let testStore: TestChordStore;

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: (selector: (state: TestChordStore) => unknown) => selector(testStore),
}));

import { ShellStatusBar } from '../../../../../../apps/chord/renderer/features/shell/status-bar';

const cue = (id: string, startMs: number) => ({ id, startMs, endMs: startMs + 1000, text: id });

afterEach(cleanup);

describe('ShellStatusBar', () => {
  it('is a labelled contentinfo landmark showing Ready and no stats for an empty project', () => {
    testStore = createTestStore();
    render(<ShellStatusBar />);
    expect(screen.getByRole('contentinfo', { name: 'LumaChord status' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText(/cues?$/)).not.toBeInTheDocument();
  });

  // No cue tally: the cues are drawn on the timeline right above this bar, so
  // counting them restated what you can already see. "N selected" stays —
  // that is transient state with nothing else reporting it.
  it('shows selection and timeline length, and never a cue tally', () => {
    testStore = createTestStore({
      document: createTestDocument({ cues: [cue('a', 0), cue('b', 2000)] as never }),
      selection: ['a'],
    });
    render(<ShellStatusBar />);
    expect(screen.queryByText('2 cues')).not.toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByText('Length 0:10.0')).toBeInTheDocument();
  });

  it('shows export progress instead of Ready while exporting', () => {
    testStore = createTestStore({ exportJob: { status: 'rendering', percent: 41.6, etaMs: null, outputPath: null, error: null } });
    render(<ShellStatusBar />);
    expect(screen.getByText('Exporting 42%')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('announces a failed export as an error status', () => {
    testStore = createTestStore({ exportJob: { status: 'failed', percent: 0, etaMs: null, outputPath: null, error: 'Disk full' } });
    render(<ShellStatusBar />);
    expect(screen.getByRole('status')).toHaveTextContent('Disk full');
  });

  it('announces a completed export and shows tap-mark progress', () => {
    testStore = createTestStore({
      exportJob: { status: 'done', percent: 100, etaMs: 0, outputPath: '/x.mp4', error: null },
      tapIndex: 2,
    });
    render(<ShellStatusBar />);
    expect(screen.getByRole('status')).toHaveTextContent('Export complete');
    expect(screen.getByText('Tap to mark: cue 3')).toBeInTheDocument();
  });
});

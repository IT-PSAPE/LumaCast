// The editor is the first screen: an untitled project with no audio and no
// cues must render every region without crashing or showing NaN.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestStore, type TestChordStore } from '../../test-store';

const box = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(box.store),
    { getState: () => box.store },
  ),
}));

vi.mock('../../../../../../apps/chord/renderer/features/library/import-flows', () => ({
  importAudio: vi.fn(),
  importBackground: vi.fn(),
  importLyrics: vi.fn(),
}));

vi.mock('../../../../../../apps/chord/renderer/features/export/export-dialog', () => ({
  ExportDialog: () => null,
  useExport: () => ({}),
}));

vi.mock('../../../../../../apps/chord/renderer/features/canvas/preview-canvas', () => ({
  PreviewCanvas: () => <div data-testid="preview-canvas" />,
}));

vi.mock('../../../../../../apps/chord/renderer/features/playback/audio-element', () => ({
  AudioElement: () => null,
}));

import { Timeline } from '../../../../../../apps/chord/renderer/features/timeline/timeline';
import { Inspector } from '../../../../../../apps/chord/renderer/features/inspector/inspector';
import { Workspace } from '../../../../../../apps/chord/renderer/features/shell/workspace';
import { ShellStatusBar } from '../../../../../../apps/chord/renderer/features/shell/status-bar';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function empty(): TestChordStore {
  const store = createTestStore();
  box.store = store as unknown as Record<string, unknown>;
  return store;
}

describe('empty untitled project', () => {
  it('Timeline shows a 10s transport readout and empty-track hints, no NaN', () => {
    empty();
    const { container } = render(<Timeline />);
    expect(screen.getByRole('button', { name: /0:00.*\/.*/ })).toBeInTheDocument();
    expect(screen.getByText('Drop an audio file here')).toBeInTheDocument();
    expect(screen.getByText('Drop a lyric file, or add a cue')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });

  it('Inspector shows the empty lyrics state', () => {
    empty();
    render(<Inspector />);
    expect(screen.getByText('No lyrics yet')).toBeInTheDocument();
  });

  it('Workspace renders top bar, canvas, inspector and timeline together', () => {
    empty();
    const { container } = render(<Workspace />);
    expect(screen.getByRole('toolbar', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument();
    expect(container.querySelector('[data-ui-region="timeline"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-region="transport-bar"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project settings' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });

  it('status bar reads Ready with no stats', () => {
    empty();
    render(<ShellStatusBar />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText(/Length/)).not.toBeInTheDocument();
  });
});

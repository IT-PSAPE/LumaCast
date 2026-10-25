import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestStore, type TestChordStore } from '../../test-store';
import { useShellUiState } from '../../../../../../apps/chord/renderer/features/shell/shell-ui-state';

let testStore: TestChordStore;

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: (selector: (state: TestChordStore) => unknown) => selector(testStore),
}));

vi.mock('../../../../../../apps/chord/renderer/features/library/import-flows', () => ({
  importAudio: vi.fn(),
  importBackground: vi.fn(),
  importLyrics: vi.fn(),
}));

vi.mock('../../../../../../apps/chord/renderer/features/export/export-dialog', () => ({
  ExportDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="export-dialog" /> : null),
  useExport: () => ({}),
}));

import { TopBar } from '../../../../../../apps/chord/renderer/features/shell/top-bar';

beforeEach(() => {
  useShellUiState.setState({ exportDialogOpen: false, cueFormatChooserOpen: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TopBar', () => {
  it('renders the project title', () => {
    const project = createTestStore().document.project;
    testStore = createTestStore({ document: { project: { ...project, title: 'My Song' }, path: null } });
    render(<TopBar />);
    expect(screen.getByText('My Song')).toBeInTheDocument();
  });

  it('disables Undo/Redo initially', () => {
    testStore = createTestStore({ canUndo: false, canRedo: false });
    render(<TopBar />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('enables Undo/Redo when the store says so, and clicking calls the store', () => {
    testStore = createTestStore({ canUndo: true, canRedo: true });
    render(<TopBar />);
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    expect(undoButton).toBeEnabled();
    fireEvent.click(undoButton);
    expect(testStore.undo).toHaveBeenCalledTimes(1);
  });

  it('the Export button is disabled for an empty project', () => {
    testStore = createTestStore();
    render(<TopBar />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('leaves New and Open to the File menu and keeps the rarely used controls out of the bar', () => {
    testStore = createTestStore();
    render(<TopBar />);
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Audio…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Frame rate' })).not.toBeInTheDocument();
  });

  it('collapses the three imports into one keyboard-reachable menu', async () => {
    const { importAudio } = await import('../../../../../../apps/chord/renderer/features/library/import-flows');
    testStore = createTestStore();
    render(<TopBar />);
    const trigger = screen.getByRole('button', { name: /Import/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Lyrics…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Background…' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Audio…' }));
    expect(importAudio).toHaveBeenCalledTimes(1);
  });

  it('holds composition, frame rate and theme preset in a project settings popover', async () => {
    testStore = createTestStore();
    render(<TopBar />);
    const trigger = screen.getByRole('button', { name: 'Project settings' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Frame rate')).toBeInTheDocument();
    expect(screen.getByText('Composition')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { pressed: false })[0]);
    expect(testStore.applyPreset).toHaveBeenCalledTimes(1);
  });

  it('the Export button opens the export dialog', () => {
    const project = createTestStore().document.project;
    testStore = createTestStore({
      document: { project: { ...project, cues: [{ id: 'a', startMs: 0, endMs: null, text: 'Hi', override: null }] }, path: null },
    });
    render(<TopBar />);
    expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByTestId('export-dialog')).toBeInTheDocument();
  });
});

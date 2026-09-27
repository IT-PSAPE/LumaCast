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

  it('the Export button opens the export dialog', () => {
    testStore = createTestStore();
    render(<TopBar />);
    expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByTestId('export-dialog')).toBeInTheDocument();
  });
});

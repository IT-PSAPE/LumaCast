import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkbenchProvider } from '../../../../../../apps/cast/renderer/contexts/workbench-context';
import { LyricEditorModal } from '../../../../../../apps/cast/renderer/features/items/lyric-editor-modal';

const mocks = vi.hoisted(() => ({
  currentItem: { id: 'lyric-1', blankSlideMode: 'start' },
  initialBlocks: [{ id: 's1', content: 'First' }],
  saveBlocks: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({ currentItem: mocks.currentItem, currentItemRef: { type: 'lyric', id: mocks.currentItem.id } }),
}));
vi.mock('../../../../../../apps/cast/renderer/features/items/use-lyric-editor-document', () => ({
  useLyricEditorSave: () => ({ initialBlocks: mocks.initialBlocks, saveBlocks: mocks.saveBlocks, isSaving: false }),
}));
vi.mock('../../../../../../apps/cast/renderer/features/items/lyric-layout-config', () => ({
  useLyricLayoutConfig: () => ({ config: {}, updateConfig: vi.fn() }),
  loadMeasureFont: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../../../apps/cast/renderer/features/items/lyric-layout-config-dialog', () => ({ LyricLayoutConfigDialog: () => null }));
vi.mock('../../../../../../apps/cast/renderer/components/overlays/confirm-dialog', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('../../../../../../apps/cast/renderer/components/form/doc-editor', () => ({ default: () => null }));

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function chooseMode(label: string) {
  const trigger = screen.getByRole('combobox', { name: 'Blank slides' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await settle();
  const options = screen.getAllByRole('option');
  const target = options.find((option) => option.textContent === label)!;
  for (let step = 0; step < options.length && !target.hasAttribute('data-highlighted'); step += 1) {
    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'ArrowDown' });
    await settle();
  }
  fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Enter' });
  await settle();
  await settle();
}

beforeEach(() => { mocks.currentItem = { id: 'lyric-1', blankSlideMode: 'start' }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LyricEditorModal blank slides', () => {
  it('loads the saved mode and stages changes until Save', async () => {
    render(<WorkbenchProvider><LyricEditorModal isOpen onClose={vi.fn()} /></WorkbenchProvider>);
    expect(screen.getByRole('combobox', { name: 'Blank slides' }).textContent).toContain('At beginning');
    await chooseMode('Beginning and end');
    expect(mocks.saveBlocks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.saveBlocks).toHaveBeenCalledWith(mocks.initialBlocks, { skipGrouping: false, blankSlideMode: 'both' });
  });

  it('confirms discarding a mode-only change and respects cancellation', async () => {
    const onClose = vi.fn();
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<WorkbenchProvider><LyricEditorModal isOpen onClose={onClose} /></WorkbenchProvider>);
    await chooseMode('None');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.saveBlocks).not.toHaveBeenCalled();
  });

  it('resets discarded settings to the persisted mode when reopened', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<WorkbenchProvider><LyricEditorModal isOpen onClose={onClose} /></WorkbenchProvider>);
    await chooseMode('None');
    rerender(<WorkbenchProvider><LyricEditorModal isOpen={false} onClose={onClose} /></WorkbenchProvider>);
    mocks.currentItem = { id: 'lyric-1', blankSlideMode: 'end' };
    rerender(<WorkbenchProvider><LyricEditorModal isOpen onClose={onClose} /></WorkbenchProvider>);
    expect(screen.getByRole('combobox', { name: 'Blank slides' }).textContent).toContain('At end');
  });
});

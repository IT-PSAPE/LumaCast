import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScenesDock, type ScenesDockProps } from '../../../../apps/stream/renderer/docks/scenes-dock';
import type { StreamScene } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

function makeScene(id: string, name: string): StreamScene {
  return { id, name, sources: [] };
}

// Base UI settles the popup's position/focus on an animation frame.
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function renderDock(overrides: Partial<ScenesDockProps> = {}) {
  const scenes = overrides.scenes ?? [makeScene('scene-1', 'Scene 1'), makeScene('scene-2', 'Scene 2')];
  const onChooseScene = overrides.onChooseScene ?? vi.fn();
  const props: ScenesDockProps = {
    platform: 'darwin',
    scenes,
    activeSceneId: scenes[0]!.id,
    liveSceneId: scenes[0]!.id,
    undoAvailable: false,
    redoAvailable: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onAddScene: vi.fn(),
    onChooseScene,
    setSceneNameDraft: vi.fn(),
    setSceneDialog: vi.fn(),
    working: false,
    onDuplicateScene: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
  render(<ScenesDock {...props} />);
  return { ...props, onChooseScene };
}

function rowFor(name: string): HTMLButtonElement {
  return screen.getByText(name).closest('button')!;
}

describe('ScenesDock', () => {
  it('no longer renders the old footer (dots, count, scene-options menu button)', () => {
    renderDock();
    expect(document.querySelector('.scene-dock-footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scene options' })).toBeNull();
  });

  it('selects a right-clicked, not-yet-active scene and opens its context menu', async () => {
    const { onChooseScene } = renderDock();
    fireEvent.contextMenu(rowFor('Scene 2'), { clientX: 10, clientY: 10 });
    await settle();

    expect(onChooseScene).toHaveBeenCalledWith('scene-2');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Add Scene' })).toBeInTheDocument();
  });

  it('does not re-select a scene that is already active when right-clicked', async () => {
    const { onChooseScene } = renderDock();
    fireEvent.contextMenu(rowFor('Scene 1'), { clientX: 10, clientY: 10 });
    await settle();

    expect(onChooseScene).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Add Scene' })).toBeInTheDocument();
  });

  it('disables Remove when only one scene exists', async () => {
    renderDock({ scenes: [makeScene('only', 'Only Scene')], activeSceneId: 'only', liveSceneId: 'only' });
    fireEvent.contextMenu(rowFor('Only Scene'), { clientX: 10, clientY: 10 });
    await settle();

    const remove = screen.getByRole('menuitem', { name: /Remove/ });
    expect(remove.getAttribute('data-disabled')).toBe('');
  });

  it('F2 shows an inline rename input, and Enter commits it via onRenameScene', () => {
    const onRenameScene = vi.fn();
    renderDock({ onRenameScene });

    fireEvent.keyDown(rowFor('Scene 1'), { key: 'F2' });
    const input = screen.getByDisplayValue('Scene 1');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameScene).toHaveBeenCalledWith('scene-1', 'Renamed');
    expect(screen.queryByDisplayValue('Renamed')).toBeNull();
  });

  it('Escape cancels an inline rename without committing', () => {
    const onRenameScene = vi.fn();
    renderDock({ onRenameScene });

    fireEvent.keyDown(rowFor('Scene 1'), { key: 'F2' });
    const input = screen.getByDisplayValue('Scene 1');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameScene).not.toHaveBeenCalled();
    expect(screen.getByText('Scene 1')).toBeInTheDocument();
  });

  it('falls back to the rename dialog when onRenameScene is not provided', () => {
    const setSceneNameDraft = vi.fn();
    const setSceneDialog = vi.fn();
    renderDock({ setSceneNameDraft, setSceneDialog });

    fireEvent.keyDown(rowFor('Scene 1'), { key: 'F2' });

    expect(screen.queryByDisplayValue('Scene 1')).toBeNull();
    expect(setSceneNameDraft).toHaveBeenCalledWith('Scene 1');
    expect(setSceneDialog).toHaveBeenCalledWith('rename');
  });

  it('Ctrl+ArrowDown reorders via onReorderScenes', () => {
    const onReorderScenes = vi.fn();
    renderDock({ onReorderScenes });

    fireEvent.keyDown(rowFor('Scene 1'), { key: 'ArrowDown', ctrlKey: true });

    expect(onReorderScenes).toHaveBeenCalledWith(['scene-2', 'scene-1']);
  });

  it('Delete asks to remove the focused scene via the existing dialog flow', () => {
    const setSceneDialog = vi.fn();
    renderDock({ setSceneDialog });

    fireEvent.keyDown(rowFor('Scene 1'), { key: 'Delete' });

    expect(setSceneDialog).toHaveBeenCalledWith('delete');
  });

  it('stops propagation on every handled key, so it never also reaches a global window keydown listener (matches sources-dock.tsx)', async () => {
    renderDock({ onReorderScenes: vi.fn(), setSceneDialog: vi.fn() });
    const windowKeyDown = vi.fn();
    window.addEventListener('keydown', windowKeyDown);
    const row = rowFor('Scene 1');

    for (const init of [
      { key: 'Delete' },
      { key: 'Backspace' },
      { key: 'ArrowDown', ctrlKey: true },
      { key: 'ArrowUp' },
      { key: 'Home' },
      { key: 'End' },
      { key: 'F2' },
      { key: 'ContextMenu' },
    ]) {
      fireEvent.keyDown(row, init);
    }
    await settle();

    window.removeEventListener('keydown', windowKeyDown);
    expect(windowKeyDown).not.toHaveBeenCalled();
  });
});

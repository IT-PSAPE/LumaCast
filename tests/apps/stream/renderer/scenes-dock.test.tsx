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
    selectionScopeKey: 'collection-1',
    activeSceneId: scenes[0]!.id,
    liveSceneId: scenes[0]!.id,
    onAddScene: vi.fn(),
    onChooseScene,
    setSceneNameDraft: vi.fn(),
    setSceneDialog: vi.fn(),
    working: false,
    onDuplicateScene: vi.fn(),
    onRequestDeleteScenes: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
  const view = render(<ScenesDock {...props} />);
  return { ...props, onChooseScene, rerender: view.rerender };
}

function rowFor(name: string): HTMLButtonElement {
  return screen.getByText(name).closest('button')!;
}

describe('ScenesDock', () => {
  it('no longer renders the old footer (dots, count, scene-options menu button)', () => {
    renderDock();
    expect(document.querySelector('.scene-dock-footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scene options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull();
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

  it('offers Transition to Program in Studio Mode and disables it for the live scene', async () => {
    renderDock({ studioMode: true });
    fireEvent.contextMenu(rowFor('Scene 1'), { clientX: 10, clientY: 10 });
    await settle();
    expect(screen.getByRole('menuitem', { name: 'Transition to Program' }).getAttribute('data-disabled')).toBe('');

    cleanup();
    renderDock({ studioMode: true });
    fireEvent.contextMenu(rowFor('Scene 2'), { clientX: 10, clientY: 10 });
    await settle();
    expect(screen.getByRole('menuitem', { name: 'Transition to Program' }).getAttribute('data-disabled')).toBeNull();
  });

  it('renders a decorative thumbnail and distinct visible Preview and Live status labels', () => {
    renderDock({
      studioMode: true,
      activeSceneId: 'scene-2',
      liveSceneId: 'scene-1',
      renderThumbnail: (scene) => <div data-testid={`thumb-${scene.id}`} />,
    });

    const previewRow = screen.getByRole('button', { name: 'Scene 2', description: 'PREVIEW' });
    expect(previewRow.querySelector('.scene-thumbnail-slot')).toContainElement(screen.getByTestId('thumb-scene-2'));
    expect(previewRow.querySelector('.scene-thumbnail-slot')).toHaveAttribute('title', 'Preview of Scene 2');
    expect(previewRow).toHaveAttribute('aria-current', 'true');
    expect(previewRow).toHaveTextContent('PREVIEW');
    expect(screen.getByRole('button', { name: 'Scene 1', description: 'LIVE' })).toHaveTextContent('LIVE');
  });

  it('can enable Transition to Program for a dirty current scene', async () => {
    const onTransitionScene = vi.fn();
    renderDock({ studioMode: true, canTransitionScene: (sceneId) => sceneId === 'scene-1', onTransitionScene });
    fireEvent.contextMenu(rowFor('Scene 1'), { clientX: 10, clientY: 10 });
    await settle();

    const transition = screen.getByRole('menuitem', { name: 'Transition to Program' });
    expect(transition.getAttribute('data-disabled')).toBeNull();
    fireEvent.click(transition);
    expect(onTransitionScene).toHaveBeenCalledWith('scene-1');
  });

  it('invokes the transition callback from the scene context menu', async () => {
    const onTransitionScene = vi.fn();
    const { onChooseScene } = renderDock({ studioMode: true, onTransitionScene });
    fireEvent.click(rowFor('Scene 2'), { ctrlKey: true });
    fireEvent.contextMenu(rowFor('Scene 2'), { clientX: 10, clientY: 10 });
    await settle();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Transition to Program' }));
    expect(onTransitionScene).toHaveBeenCalledWith('scene-2');
    expect(onChooseScene).not.toHaveBeenCalled();
  });

  it('duplicates the scene whose context menu was opened without changing the preview first', async () => {
    const onDuplicateScene = vi.fn();
    const { onChooseScene } = renderDock({ onDuplicateScene });
    fireEvent.click(rowFor('Scene 2'), { ctrlKey: true });
    fireEvent.contextMenu(rowFor('Scene 2'), { clientX: 10, clientY: 10 });
    await settle();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(onDuplicateScene).toHaveBeenCalledWith('scene-2');
    expect(onChooseScene).not.toHaveBeenCalled();
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

  it('uses Ctrl/Cmd toggles and Shift ranges without choosing a preview or live scene', () => {
    const scenes = ['scene-1', 'scene-2', 'scene-3', 'scene-4'].map((id, index) => makeScene(id, `Scene ${index + 1}`));
    const onChooseScene = vi.fn();
    renderDock({ scenes, onChooseScene });

    fireEvent.click(rowFor('Scene 2'), { ctrlKey: true });
    fireEvent.click(rowFor('Scene 4'), { shiftKey: true });

    expect(rowFor('Scene 2')).toHaveClass('multi-selected');
    expect(rowFor('Scene 3')).toHaveClass('multi-selected');
    expect(rowFor('Scene 4')).toHaveClass('multi-selected');
    expect(rowFor('Scene 1')).toHaveAttribute('aria-current', 'true');
    expect(rowFor('Scene 1')).toHaveAttribute('aria-pressed', 'false');
    expect(rowFor('Scene 2')).toHaveAttribute('aria-pressed', 'true');
    expect(onChooseScene).not.toHaveBeenCalled();
  });

  it('keeps ordinary scene clicks choosing the scene', () => {
    const onChooseScene = vi.fn();
    renderDock({ onChooseScene });

    fireEvent.click(rowFor('Scene 2'));

    expect(onChooseScene).toHaveBeenCalledOnce();
    expect(onChooseScene).toHaveBeenCalledWith('scene-2');
  });

  it('clears transient selection and a pending group delete when the scene collection changes', () => {
    const rendered = renderDock({ scenes: ['scene-1', 'scene-2', 'scene-3'].map((id, index) => makeScene(id, `Scene ${index + 1}`)) });
    const { rerender, ...props } = rendered;
    fireEvent.click(rowFor('Scene 2'), { ctrlKey: true });
    fireEvent.click(rowFor('Scene 3'), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected scenes' }));

    rerender(<ScenesDock {...props} selectionScopeKey="collection-2" />);

    expect(rowFor('Scene 2')).not.toHaveClass('multi-selected');
    expect(screen.queryByRole('dialog', { name: 'Delete 2 scenes?' })).toBeNull();
  });

  it('confirms one group delete and submits selected scenes in visible order', () => {
    const scenes = ['scene-1', 'scene-2', 'scene-3', 'scene-4'].map((id, index) => makeScene(id, `Scene ${index + 1}`));
    const onRequestDeleteScenes = vi.fn();
    const onChooseScene = vi.fn();
    renderDock({ scenes, onChooseScene, onRequestDeleteScenes });

    fireEvent.click(rowFor('Scene 2'), { ctrlKey: true });
    fireEvent.click(rowFor('Scene 3'), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected scenes' }));

    expect(screen.getByRole('dialog', { name: 'Delete 2 scenes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 scenes' }));

    expect(onRequestDeleteScenes).toHaveBeenCalledOnce();
    expect(onRequestDeleteScenes).toHaveBeenCalledWith(['scene-2', 'scene-3']);
    expect(onChooseScene).not.toHaveBeenCalled();
  });

  it('keeps the active scene out of a delete-all request', () => {
    const scenes = ['scene-1', 'scene-2', 'scene-3'].map((id, index) => makeScene(id, `Scene ${index + 1}`));
    const onRequestDeleteScenes = vi.fn();
    renderDock({ scenes, activeSceneId: 'scene-2', onRequestDeleteScenes });

    for (const scene of scenes) fireEvent.click(rowFor(scene.name), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 selected scenes' }));

    expect(screen.getByRole('dialog', { name: 'Delete 2 scenes?' })).toBeInTheDocument();
    expect(screen.getByText(/One scene will remain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 scenes' }));

    expect(onRequestDeleteScenes).toHaveBeenCalledOnce();
    expect(onRequestDeleteScenes).toHaveBeenCalledWith(['scene-1', 'scene-3']);
  });

  it('reorders the selected group and sends the complete new scene order for persistence', () => {
    const scenes = ['scene-1', 'scene-2', 'scene-3', 'scene-4'].map((id, index) => makeScene(id, `Scene ${index + 1}`));
    const onReorderScenes = vi.fn();
    renderDock({ scenes, onReorderScenes });

    fireEvent.click(rowFor('Scene 2'), { ctrlKey: true });
    fireEvent.click(rowFor('Scene 3'), { ctrlKey: true });
    fireEvent.keyDown(rowFor('Scene 3'), { key: 'ArrowUp', ctrlKey: true });

    expect(onReorderScenes).toHaveBeenCalledOnce();
    expect(onReorderScenes).toHaveBeenCalledWith(['scene-2', 'scene-3', 'scene-1', 'scene-4']);
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

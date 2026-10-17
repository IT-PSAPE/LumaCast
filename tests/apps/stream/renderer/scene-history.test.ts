// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../../../../apps/stream/shared/desktop-api';
import { sceneEditorState, SceneHistory } from '../../../../apps/stream/renderer/scene-history';

describe('LumaStream scene editing history', () => {
  it('undoes and redoes scene changes while discarding redo after a new edit', () => {
    const history = new SceneHistory();
    const initial = createDefaultProject();
    const firstEdit = structuredClone(initial);
    firstEdit.scenes[0]!.name = 'Starting Soon';
    const secondEdit = structuredClone(firstEdit);
    secondEdit.scenes[0]!.name = 'Live';

    history.record(sceneEditorState(initial), 0);
    history.record(sceneEditorState(firstEdit), 800);
    expect(history.undo(sceneEditorState(secondEdit))?.scenes[0]?.name).toBe('Starting Soon');
    const newEdit = structuredClone(firstEdit);
    newEdit.scenes[0]!.name = 'Intermission';
    history.record(sceneEditorState(firstEdit), 1600);
    expect(history.canRedo).toBe(false);
    expect(history.redo(sceneEditorState(newEdit))).toBeNull();
  });

  it('coalesces rapid canvas edits and keeps the latest snapshot for redo', () => {
    const history = new SceneHistory();
    const first = createDefaultProject();
    const second = structuredClone(first);
    second.scenes[0]!.sources.push({
      id: 'color', name: 'Color', kind: 'color', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1920, height: 1080 }, color: '#000000',
    });
    const third = structuredClone(second);
    third.scenes[0]!.sources[0]!.name = 'Backdrop';

    history.record(sceneEditorState(first), 1000);
    history.record(sceneEditorState(second), 1200);
    const undone = history.undo(sceneEditorState(third));
    expect(undone?.scenes[0]?.sources).toHaveLength(0);
    expect(history.redo(sceneEditorState(undone!))?.scenes[0]?.sources[0]?.name).toBe('Backdrop');
  });

  it('caps stored snapshots and clears both directions', () => {
    const history = new SceneHistory(2);
    let previous = createDefaultProject();
    for (let index = 0; index < 3; index++) {
      const next = structuredClone(previous);
      next.scenes[0]!.name = `Scene ${index}`;
      history.record(sceneEditorState(previous), index * 1000);
      previous = next;
    }
    expect(history.undo(sceneEditorState(previous))?.scenes[0]?.name).toBe('Scene 1');
    expect(history.undo(sceneEditorState(previous))?.scenes[0]?.name).toBe('Scene 0');
    expect(history.canUndo).toBe(false);
    history.clear();
    expect(history.canRedo).toBe(false);
  });

  it('restores scene-switch bindings when undoing a scene change', () => {
    const history = new SceneHistory();
    const before = createDefaultProject();
    const sceneId = before.scenes[0]!.id;
    before.sceneSwitchHotkeys[sceneId] = 'Control+Shift+1';
    const after = structuredClone(before);
    after.sceneSwitchHotkeys = {};
    history.record(sceneEditorState(before), 0);

    expect(history.undo(sceneEditorState(after))?.sceneSwitchHotkeys).toEqual({ [sceneId]: 'Control+Shift+1' });
  });
});

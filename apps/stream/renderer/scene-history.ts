import type { StreamProject, StreamScene } from '../shared/desktop-api';

export interface SceneEditorState {
  scenes: StreamScene[];
  activeSceneId: string;
  liveSceneId: string;
  sceneSwitchHotkeys: Record<string, string>;
  sourceVisibilityHotkeys: Record<string, string>;
}

function copyState(state: SceneEditorState): SceneEditorState {
  return structuredClone(state);
}

export function sceneEditorState(project: Pick<StreamProject, 'scenes' | 'activeSceneId' | 'liveSceneId' | 'sceneSwitchHotkeys' | 'sourceVisibilityHotkeys'>): SceneEditorState {
  return {
    scenes: project.scenes,
    activeSceneId: project.activeSceneId,
    liveSceneId: project.liveSceneId,
    sceneSwitchHotkeys: project.sceneSwitchHotkeys,
    sourceVisibilityHotkeys: project.sourceVisibilityHotkeys,
  };
}

export class SceneHistory {
  private readonly undoStack: SceneEditorState[] = [];
  private readonly redoStack: SceneEditorState[] = [];
  private lastRecordedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly capacity = 100, private readonly coalesceWindowMs = 500) {}

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  record(previous: SceneEditorState, at: number): void {
    if (at - this.lastRecordedAt >= this.coalesceWindowMs) {
      this.undoStack.push(copyState(previous));
      if (this.undoStack.length > this.capacity) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.lastRecordedAt = at;
  }

  undo(current: SceneEditorState): SceneEditorState | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(copyState(current));
    this.lastRecordedAt = Number.NEGATIVE_INFINITY;
    return copyState(previous);
  }

  redo(current: SceneEditorState): SceneEditorState | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(copyState(current));
    this.lastRecordedAt = Number.NEGATIVE_INFINITY;
    return copyState(next);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lastRecordedAt = Number.NEGATIVE_INFINITY;
  }
}

import {
  useEffect, useRef, useState,
  type CSSProperties, type Dispatch, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
  type ReactNode, type SetStateAction,
} from 'react';
import { Layers2, Plus, Redo2, Undo2, X } from 'lucide-react';
import { Badge, PointContextMenu, Panel, ReacstButton, usePointContextMenu, type MenuEntry, type PointContextMenuTrigger } from '@lumacast/ui';
import { moveSceneBy, moveSceneTo, reorderOnDrop } from '../scene-order';
import { primaryShortcutLabel, type StreamPlatform } from '../../shared/platform-capabilities';
import type { StreamScene } from '../../shared/desktop-api';
import './scenes-dock.css';

// Pointer movement (px) a row must travel before a press becomes a drag
// rather than a click.
const DRAG_THRESHOLD = 4;

export interface ScenesDockProps {
  style?: CSSProperties;
  resizer?: ReactNode;
  onHide: () => void;
  platform: StreamPlatform;
  scenes: StreamScene[];
  activeSceneId: string;
  liveSceneId: string;
  undoAvailable: boolean;
  redoAvailable: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddScene: () => void;
  onChooseScene: (sceneId: string) => void;
  setSceneNameDraft: Dispatch<SetStateAction<string>>;
  setSceneDialog: Dispatch<SetStateAction<'rename' | 'delete' | null>>;
  working: boolean;
  onDuplicateScene: () => void;
  /** Enables the "Transition to Program" context-menu action. */
  studioMode?: boolean;
  /** Transitions the selected scene to program. */
  onTransitionScene?: () => void;
  /** Opens a projector window of the given kind. Projector submenu is omitted when absent. */
  onOpenProjector?: (kind: 'preview' | 'program') => void;
  /** Commits an inline rename. Falls back to the rename dialog (setSceneDialog) when absent. */
  onRenameScene?: (sceneId: string, name: string) => void;
  /** Persists a new scene order, from the Order submenu, Ctrl/Cmd+Arrow, or a row drag. */
  onReorderScenes?: (sceneIds: string[]) => void;
}

function deleteShortcutLabel(platform: StreamPlatform): string {
  return platform === 'darwin' ? '⌫' : 'Delete';
}

interface DragState {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
}

export function ScenesDock({
  style,
  resizer,
  onHide,
  platform,
  scenes,
  activeSceneId,
  liveSceneId,
  undoAvailable,
  redoAvailable,
  onUndo,
  onRedo,
  onAddScene,
  onChooseScene,
  setSceneNameDraft,
  setSceneDialog,
  working,
  onDuplicateScene,
  studioMode = false,
  onTransitionScene,
  onOpenProjector,
  onRenameScene,
  onReorderScenes,
}: ScenesDockProps) {
  const contextMenu = usePointContextMenu();
  const [menuSceneId, setMenuSceneId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragStateRef = useRef<DragState | null>(null);
  const didDragRef = useRef(false);
  const skipRenameBlurRef = useRef(false);
  // Read by the window `pointerup` listener below, which is attached once per
  // `scenes`/`onReorderScenes` change (not per drag frame) and so can't close
  // over a fresh `dropIndex` from render — mirrored here instead of reading it
  // out of a `setDropIndex` functional updater, which previously called
  // `onReorderScenes` (an App setter) from inside this component's own state
  // updater and tripped React's "setState while rendering a different
  // component" warning.
  const dropIndexRef = useRef(dropIndex);
  dropIndexRef.current = dropIndex;

  useEffect(() => {
    function computeDropIndex(clientY: number): number {
      const ids = scenes.map((scene) => scene.id);
      for (let index = 0; index < ids.length; index += 1) {
        const row = rowRefs.current.get(ids[index]!);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return index;
      }
      return ids.length;
    }

    function handlePointerMove(event: PointerEvent) {
      const state = dragStateRef.current;
      if (!state) return;
      if (!state.active) {
        const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
        if (distance < DRAG_THRESHOLD) return;
        state.active = true;
        didDragRef.current = true;
        setDragId(state.id);
      }
      setDropIndex(computeDropIndex(event.clientY));
    }

    function handlePointerUp() {
      const state = dragStateRef.current;
      if (state?.active) {
        const currentDropIndex = dropIndexRef.current;
        if (currentDropIndex !== null) {
          const next = reorderOnDrop(scenes.map((scene) => scene.id), state.id, currentDropIndex);
          onReorderScenes?.(next);
        }
        setDropIndex(null);
        // A click synthesized right after this pointerup (mouseup landing back
        // on the dragged row) must not also select it — swallow just that one.
        setTimeout(() => { didDragRef.current = false; }, 0);
      }
      dragStateRef.current = null;
      setDragId(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && dragStateRef.current) {
        dragStateRef.current = null;
        setDragId(null);
        setDropIndex(null);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [scenes, onReorderScenes]);

  function registerRow(sceneId: string, element: HTMLButtonElement | null) {
    if (element) rowRefs.current.set(sceneId, element);
    else rowRefs.current.delete(sceneId);
  }

  function focusScene(scene: StreamScene | undefined) {
    if (!scene) return;
    onChooseScene(scene.id);
    rowRefs.current.get(scene.id)?.focus();
  }

  function startRename(scene: StreamScene) {
    if (scene.id !== activeSceneId) onChooseScene(scene.id);
    if (onRenameScene) {
      setRenamingId(scene.id);
      setRenameDraft(scene.name);
    } else {
      setSceneNameDraft(scene.name);
      setSceneDialog('rename');
    }
  }

  function cancelRename() {
    skipRenameBlurRef.current = true;
    setRenamingId(null);
  }

  function commitRename(scene: StreamScene) {
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false;
      return;
    }
    const trimmed = renameDraft.trim().slice(0, 120);
    setRenamingId(null);
    if (!trimmed || trimmed === scene.name) return;
    onRenameScene?.(scene.id, trimmed);
  }

  function requestRemove(scene: StreamScene) {
    if (scenes.length <= 1) return;
    if (scene.id !== activeSceneId) onChooseScene(scene.id);
    setSceneDialog('delete');
  }

  function openSceneMenu(scene: StreamScene, trigger: PointContextMenuTrigger) {
    if (scene.id !== activeSceneId) onChooseScene(scene.id);
    setMenuSceneId(scene.id);
    contextMenu.show(trigger);
  }

  function buildMenuEntries(scene: StreamScene, index: number): MenuEntry[] {
    const ids = scenes.map((candidate) => candidate.id);
    const entries: MenuEntry[] = [
      { id: 'add', label: 'Add Scene', onSelect: onAddScene },
      { id: 'duplicate', label: 'Duplicate', disabled: working, onSelect: onDuplicateScene },
      { id: 'rename', label: 'Rename', shortcut: 'F2', onSelect: () => startRename(scene) },
      {
        id: 'remove',
        label: 'Remove',
        danger: true,
        disabled: scenes.length <= 1,
        shortcut: deleteShortcutLabel(platform),
        onSelect: () => requestRemove(scene),
      },
      { separator: true },
      {
        id: 'order',
        label: 'Order',
        children: [
          { id: 'move-up', label: 'Move Up', disabled: index === 0, onSelect: () => onReorderScenes?.(moveSceneBy(ids, scene.id, -1)) },
          { id: 'move-down', label: 'Move Down', disabled: index === scenes.length - 1, onSelect: () => onReorderScenes?.(moveSceneBy(ids, scene.id, 1)) },
          { id: 'move-top', label: 'Move to Top', disabled: index === 0, onSelect: () => onReorderScenes?.(moveSceneTo(ids, scene.id, 0)) },
          { id: 'move-bottom', label: 'Move to Bottom', disabled: index === scenes.length - 1, onSelect: () => onReorderScenes?.(moveSceneTo(ids, scene.id, scenes.length - 1)) },
        ],
      },
    ];

    if (studioMode) {
      entries.push({ separator: true });
      entries.push({
        id: 'transition',
        label: 'Transition to Program',
        disabled: scene.id === liveSceneId,
        onSelect: () => onTransitionScene?.(),
      });
    }

    if (onOpenProjector) {
      entries.push({ separator: true });
      entries.push({
        id: 'projector',
        label: 'Projector',
        children: [
          { id: 'projector-preview', label: 'Preview', onSelect: () => onOpenProjector('preview') },
          { id: 'projector-program', label: 'Program', onSelect: () => onOpenProjector('program') },
        ],
      });
    }

    return entries;
  }

  function handleRowClick(event: ReactMouseEvent<HTMLButtonElement>, scene: StreamScene) {
    if (didDragRef.current) {
      didDragRef.current = false;
      event.preventDefault();
      return;
    }
    onChooseScene(scene.id);
  }

  function handleRowPointerDown(event: ReactPointerEvent<HTMLButtonElement>, scene: StreamScene) {
    if (event.button !== 0 || renamingId) return;
    dragStateRef.current = { id: scene.id, startX: event.clientX, startY: event.clientY, active: false };
  }

  function handleRowContextMenu(event: ReactMouseEvent<HTMLButtonElement>, scene: StreamScene) {
    openSceneMenu(scene, event);
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, scene: StreamScene, index: number) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openSceneMenu(scene, {
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + Math.min(rect.height, 24) / 2),
        preventDefault() {},
      });
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      startRename(scene);
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      requestRemove(scene);
      return;
    }

    const isVerticalArrow = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (isVerticalArrow && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      onReorderScenes?.(moveSceneBy(scenes.map((candidate) => candidate.id), scene.id, delta));
      return;
    }

    if (isVerticalArrow) {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      focusScene(scenes[Math.max(0, Math.min(scenes.length - 1, index + delta))]);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      focusScene(scenes[0]);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      focusScene(scenes[scenes.length - 1]);
    }
  }

  const menuScene = scenes.find((scene) => scene.id === menuSceneId) ?? null;
  const menuIndex = menuScene ? scenes.indexOf(menuScene) : -1;
  const dropBeforeId = dropIndex !== null && dropIndex < scenes.length ? (scenes[dropIndex]?.id ?? null) : null;
  const dropAtEnd = dropIndex !== null && dropIndex === scenes.length && scenes.length > 0;

  return (
    <Panel density="compact" className="dock scenes-dock" style={style}>
      {resizer}
      <Panel.Header data-dock-handle className="cursor-grab select-none">
        <Panel.HeaderTitle>Scenes</Panel.HeaderTitle>
        <Panel.HeaderActions>
          <ReacstButton.Icon variant="ghost" size="sm" label="Undo" tooltip={`Undo (${primaryShortcutLabel(platform, 'Z')})`} disabled={!undoAvailable} onClick={onUndo}><Undo2 /></ReacstButton.Icon>
          <ReacstButton.Icon variant="ghost" size="sm" label="Redo" tooltip={`Redo (${primaryShortcutLabel(platform, 'Z', true)})`} disabled={!redoAvailable} onClick={onRedo}><Redo2 /></ReacstButton.Icon>
          <ReacstButton.Icon variant="ghost" size="sm" label="Add scene" onClick={onAddScene}><Plus /></ReacstButton.Icon>

          <ReacstButton.Icon variant="ghost" size="sm" label="Hide Scenes" onClick={onHide}><X /></ReacstButton.Icon>
        </Panel.HeaderActions>
      </Panel.Header>
      <div className="scene-list">
        {scenes.map((scene, index) => {
          const isActive = scene.id === activeSceneId;
          const isLive = scene.id === liveSceneId;
          const isRenaming = scene.id === renamingId;
          const isLast = index === scenes.length - 1;
          const classNames = [
            'scene-row',
            isActive ? 'selected' : '',
            isLive ? 'live' : '',
            dragId === scene.id ? 'dragging' : '',
            dropBeforeId === scene.id ? 'drag-over-before' : '',
            isLast && dropAtEnd ? 'drag-over-after' : '',
          ].filter(Boolean).join(' ');

          return (
            <button
              key={scene.id}
              ref={(element) => registerRow(scene.id, element)}
              type="button"
              className={classNames}
              tabIndex={isActive ? 0 : -1}
              onClick={(event) => handleRowClick(event, scene)}
              onDoubleClick={() => startRename(scene)}
              onContextMenu={(event) => handleRowContextMenu(event, scene)}
              onKeyDown={(event) => handleRowKeyDown(event, scene, index)}
              onPointerDown={(event) => handleRowPointerDown(event, scene)}
            >
              <span className="scene-swatch"><Layers2 size={14} /></span>
              {isRenaming ? (
                <input
                  className="scene-rename-input"
                  value={renameDraft}
                  autoFocus
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') { event.preventDefault(); commitRename(scene); }
                    else if (event.key === 'Escape') { event.preventDefault(); cancelRename(); }
                  }}
                  onBlur={() => commitRename(scene)}
                />
              ) : <span className="scene-name">{scene.name}</span>}
              {isLive && <Badge tone="error" shape="rounded">LIVE</Badge>}
            </button>
          );
        })}
      </div>
      <PointContextMenu
        open={contextMenu.open}
        position={contextMenu.position}
        entries={menuScene ? buildMenuEntries(menuScene, menuIndex) : []}
        label={menuScene ? `${menuScene.name} options` : 'Scene options'}
        onClose={contextMenu.close}
      />
    </Panel>
  );
}

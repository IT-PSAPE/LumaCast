import {
  useEffect, useMemo, useRef, useState,
  type CSSProperties, type Dispatch, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
  type ReactNode, type SetStateAction,
} from 'react';
import { Layers2, Plus, Trash2, X } from 'lucide-react';
import { Badge, Modal, PointContextMenu, Panel, ReacstButton, usePointContextMenu, type MenuEntry, type PointContextMenuTrigger } from '@lumacast/ui';
import { moveSelectedIds, useMultiSelection, useMultiSelectionKeyHandler, type SelectionModifiers } from '@lumacast/selection';
import { reorderSelectionOnDrop } from '../scene-order';
import type { StreamPlatform } from '../../shared/platform-capabilities';
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
  /** Resets transient scene selection when the active collection changes. */
  selectionScopeKey: string | null;
  activeSceneId: string;
  liveSceneId: string;
  onAddScene: () => void;
  onChooseScene: (sceneId: string) => void;
  setSceneNameDraft: Dispatch<SetStateAction<string>>;
  setSceneDialog: Dispatch<SetStateAction<'rename' | 'delete' | null>>;
  working: boolean;
  onDuplicateScene: (sceneId?: string) => void;
  /** Enables the "Transition to Program" context-menu action. */
  studioMode?: boolean;
  /** Transitions the active scene, or the supplied scene, to program. */
  onTransitionScene?: (sceneId?: string) => void;
  /** Allows a dirty current scene to be committed to Program without changing scene ID. */
  canTransitionScene?: (sceneId: string) => boolean;
  /** Renders the decorative composition thumbnail and audio meter for a scene. */
  renderThumbnail?: (scene: StreamScene) => ReactNode;
  /** Opens a projector window of the given kind. Projector submenu is omitted when absent. */
  onOpenProjector?: (kind: 'preview' | 'program') => void;
  /** Commits an inline rename. Falls back to the rename dialog (setSceneDialog) when absent. */
  onRenameScene?: (sceneId: string, name: string) => void;
  /** Persists a new scene order, from the Order submenu, Ctrl/Cmd+Arrow, or a row drag. */
  onReorderScenes?: (sceneIds: string[]) => void;
  /** Removes the supplied scenes after the Scenes dock's one-confirm group-delete dialog. */
  onRequestDeleteScenes: (sceneIds: string[]) => void;
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
  selectionScopeKey,
  activeSceneId,
  liveSceneId,
  onAddScene,
  onChooseScene,
  setSceneNameDraft,
  setSceneDialog,
  working,
  onDuplicateScene,
  studioMode = false,
  onTransitionScene,
  canTransitionScene,
  renderThumbnail,
  onOpenProjector,
  onRenameScene,
  onReorderScenes,
  onRequestDeleteScenes,
}: ScenesDockProps) {
  const contextMenu = usePointContextMenu();
  const [menuSceneId, setMenuSceneId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const sceneIds = useMemo(() => scenes.map((scene) => scene.id), [scenes]);
  const selection = useMultiSelection(sceneIds, selectionScopeKey);
  const selectionCount = selection.selectedIds.size;
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selectionCount,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  useEffect(() => {
    setPendingDeleteIds(null);
  }, [selectionScopeKey]);

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
      for (let index = 0; index < sceneIds.length; index += 1) {
        const row = rowRefs.current.get(sceneIds[index]!);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return index;
      }
      return sceneIds.length;
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
          const next = reorderSelectionOnDrop(sceneIds, state.id, currentDropIndex, selection.selectedIds);
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
  }, [sceneIds, onReorderScenes, selection.selectedIds]);

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
    const selectedIds = selection.actionIds(scene.id);
    if (selectedIds.length > 1) {
      const removableIds = selectedIds.length === scenes.length
        ? selectedIds.filter((sceneId) => sceneId !== activeSceneId)
        : selectedIds;
      setPendingDeleteIds(removableIds);
      return;
    }
    if (scene.id !== activeSceneId) onChooseScene(scene.id);
    setSceneDialog('delete');
  }

  function confirmRemoveSelected() {
    if (!pendingDeleteIds) return;
    onRequestDeleteScenes(pendingDeleteIds);
    setPendingDeleteIds(null);
    selection.clearSelection();
  }

  function openSceneMenu(scene: StreamScene, trigger: PointContextMenuTrigger) {
    if (!selection.selectedIds.has(scene.id)) {
      selection.select(scene.id);
      if (scene.id !== activeSceneId) onChooseScene(scene.id);
    }
    setMenuSceneId(scene.id);
    contextMenu.show(trigger);
  }

  function buildMenuEntries(scene: StreamScene): MenuEntry[] {
    const ids = sceneIds;
    const selectedIds = selection.actionIds(scene.id);
    const movingIds = selection.selectedIds.has(scene.id) ? selection.selectedIds : new Set([scene.id]);
    const movingIndexes = ids.flatMap((id, idIndex) => movingIds.has(id) ? [idIndex] : []);
    const movingStart = movingIndexes[0] ?? ids.indexOf(scene.id);
    const movingEnd = movingIndexes.at(-1) ?? ids.indexOf(scene.id);
    const moveSelectionBy = (delta: -1 | 1) => {
      const targetIndex = delta < 0 ? movingStart - 1 : movingEnd + 1;
      if (targetIndex < 0 || targetIndex >= ids.length) return [...ids];
      return moveSelectedIds(ids, scene.id, targetIndex, movingIds);
    };
    const moveSelectionToEdge = (edge: 'top' | 'bottom') => {
      const moving = ids.filter((id) => movingIds.has(id));
      const remaining = ids.filter((id) => !movingIds.has(id));
      return edge === 'top' ? [...moving, ...remaining] : [...remaining, ...moving];
    };
    const entries: MenuEntry[] = [
      { id: 'add', label: 'Add Scene', onSelect: onAddScene },
      { id: 'duplicate', label: 'Duplicate', disabled: working, onSelect: () => onDuplicateScene(scene.id) },
      { id: 'rename', label: 'Rename', shortcut: 'F2', onSelect: () => startRename(scene) },
      {
        id: 'remove',
        label: selectedIds.length > 1 ? `Remove ${selectedIds.length} Selected` : 'Remove',
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
          { id: 'move-up', label: 'Move Up', disabled: movingStart === 0, onSelect: () => onReorderScenes?.(moveSelectionBy(-1)) },
          { id: 'move-down', label: 'Move Down', disabled: movingEnd === scenes.length - 1, onSelect: () => onReorderScenes?.(moveSelectionBy(1)) },
          { id: 'move-top', label: 'Move to Top', disabled: movingStart === 0, onSelect: () => onReorderScenes?.(moveSelectionToEdge('top')) },
          { id: 'move-bottom', label: 'Move to Bottom', disabled: movingEnd === scenes.length - 1, onSelect: () => onReorderScenes?.(moveSelectionToEdge('bottom')) },
        ],
      },
    ];

    if (studioMode) {
      entries.push({ separator: true });
      entries.push({
        id: 'transition',
        label: 'Transition to Program',
        disabled: canTransitionScene ? !canTransitionScene(scene.id) : scene.id === liveSceneId,
        onSelect: () => onTransitionScene?.(scene.id),
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
    const modifiers: SelectionModifiers = {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    };
    if (modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey) {
      selection.select(scene.id, modifiers);
      return;
    }
    selection.select(scene.id);
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
      const moving = selection.selectedIds.has(scene.id) ? selection.selectedIds : new Set([scene.id]);
      const indexes = sceneIds.flatMap((id, idIndex) => moving.has(id) ? [idIndex] : []);
      const targetIndex = delta < 0 ? Math.min(...indexes) - 1 : Math.max(...indexes) + 1;
      if (targetIndex >= 0 && targetIndex < sceneIds.length) {
        onReorderScenes?.(moveSelectedIds(sceneIds, scene.id, targetIndex, moving));
      }
      return;
    }

    if (isVerticalArrow) {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const target = scenes[Math.max(0, Math.min(scenes.length - 1, index + delta))];
      if (event.shiftKey && target) {
        selection.select(target.id, { shiftKey: true });
        rowRefs.current.get(target.id)?.focus();
      } else focusScene(target);
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
  const dropBeforeId = dropIndex !== null && dropIndex < scenes.length ? (scenes[dropIndex]?.id ?? null) : null;
  const dropAtEnd = dropIndex !== null && dropIndex === scenes.length && scenes.length > 0;

  return (
    <Panel density="compact" className="dock scenes-dock" style={style}>
      {resizer}
      <Panel.Header data-dock-handle className="cursor-grab select-none">
        <Panel.HeaderTitle>Scenes</Panel.HeaderTitle>
        <Panel.HeaderActions>
          <ReacstButton.Icon variant="ghost" size="sm" label="Add scene" onClick={onAddScene}><Plus /></ReacstButton.Icon>
          {selectionCount > 1 && <ReacstButton.Icon variant="ghost" size="sm" label={`Delete ${selectionCount} selected scenes`} tooltip={`Delete ${selectionCount} selected scenes`} onClick={() => {
            const firstSelected = scenes.find((scene) => selection.selectedIds.has(scene.id));
            if (firstSelected) requestRemove(firstSelected);
          }}><Trash2 /></ReacstButton.Icon>}

          <ReacstButton.Icon variant="ghost" size="sm" label="Hide Scenes" onClick={onHide}><X /></ReacstButton.Icon>
        </Panel.HeaderActions>
      </Panel.Header>
      <div className="scene-list" onKeyDown={handleSelectionKeys}>
        {scenes.map((scene, index) => {
          const isActive = scene.id === activeSceneId;
          const isMultiSelected = selection.selectedIds.has(scene.id);
          const isLive = scene.id === liveSceneId;
          const isPreview = scene.id === activeSceneId && (studioMode || !isLive);
          const isRenaming = scene.id === renamingId;
          const isLast = index === scenes.length - 1;
          const classNames = [
            'scene-row',
            isActive ? 'selected' : '',
            isMultiSelected ? 'multi-selected' : '',
            isLive ? 'live' : '',
            dragId === scene.id ? 'dragging' : '',
            dropBeforeId === scene.id ? 'drag-over-before' : '',
            isLast && dropAtEnd ? 'drag-over-after' : '',
          ].filter(Boolean).join(' ');
          const statusIds = [
            isPreview ? `scene-preview-status-${scene.id}` : null,
            isLive ? `scene-live-status-${scene.id}` : null,
          ].filter((id): id is string => id !== null);

          return (
            <button
              key={scene.id}
              ref={(element) => registerRow(scene.id, element)}
              type="button"
              className={classNames}
              aria-label={scene.name}
              aria-describedby={statusIds.length > 0 ? statusIds.join(' ') : undefined}
              aria-pressed={isMultiSelected}
              aria-current={isActive ? 'true' : undefined}
              tabIndex={isActive ? 0 : -1}
              onClick={(event) => handleRowClick(event, scene)}
              onDoubleClick={() => startRename(scene)}
              onContextMenu={(event) => handleRowContextMenu(event, scene)}
              onKeyDown={(event) => handleRowKeyDown(event, scene, index)}
              onPointerDown={(event) => handleRowPointerDown(event, scene)}
            >
              <span className="scene-thumbnail-slot" title={`Preview of ${scene.name}`}>
                {renderThumbnail?.(scene) ?? <span className="scene-thumbnail-fallback" aria-hidden="true"><Layers2 size={16} /></span>}
              </span>
              <span className="scene-row-details">
                {isRenaming ? (
                  <input
                    className="scene-rename-input"
                    aria-label={`Rename scene ${scene.name}`}
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
                <span className="scene-row-status">
                  {isPreview && <span id={`scene-preview-status-${scene.id}`}><Badge tone="brand" shape="box">PREVIEW</Badge></span>}
                  {isLive && <span id={`scene-live-status-${scene.id}`}><Badge tone="error" shape="box">LIVE</Badge></span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <PointContextMenu
        open={contextMenu.open}
        position={contextMenu.position}
        entries={menuScene ? buildMenuEntries(menuScene) : []}
        label={menuScene ? `${menuScene.name} options` : 'Scene options'}
        onClose={contextMenu.close}
      />
      <Modal
        open={pendingDeleteIds !== null}
        onClose={() => setPendingDeleteIds(null)}
        title={`Delete ${pendingDeleteIds?.length ?? 0} scenes?`}
        className="scene-modal"
        footer={<>
          <button className="secondary-button" type="button" onClick={() => setPendingDeleteIds(null)}>Cancel</button>
          <button className="primary-button danger-button" type="button" onClick={confirmRemoveSelected}>Delete {pendingDeleteIds?.length ?? 0} scenes</button>
        </>}
      >
        <div className="scene-delete-copy">
          Delete {pendingDeleteIds?.length ?? 0} selected scenes and remove their sources and scene references from this collection?
          {pendingDeleteIds?.length === scenes.length - 1 ? ' One scene will remain in the collection.' : ''}
        </div>
      </Modal>
    </Panel>
  );
}

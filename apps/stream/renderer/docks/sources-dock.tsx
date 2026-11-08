import {
  useEffect, useRef, useState,
  type CSSProperties, type Dispatch, type JSX, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction,
} from 'react';
import {
  ChevronDown, ChevronRight, CircleAlert, Copy, Eye, EyeOff, FileAudio, FileVideo, Globe, Headphones, Image as ImageIcon, Images,
  Layers, Layers2, Lock, LockOpen, Mic, Monitor, MoreHorizontal, Move, Grid2X2, PanelsTopLeft, Plus, Presentation, TriangleAlert, Type, Webcam, X,
} from 'lucide-react';
import { ContextMenu, DropdownMenu, EmptyState, Modal, PointContextMenu, Panel, ReacstButton, usePointContextMenu, type MenuEntry } from '@lumacast/ui';
import { moveSelectedIds, moveSelectionToGap, useMultiSelectionKeyHandler, type SelectionModifiers } from '@lumacast/selection';
import { sourceIcon, supportsSourceTransform } from '../source-ui';
import { SourceProperties, type SourcePropertiesProps } from './source-properties';
import { fallbackSourceMoveSteps, reorderSourceSiblingsOnDrop } from '../source-order';
import { DockHeader } from './dock-header';
import { primaryShortcutLabel, type DesktopAudioCaptureMode, type StreamPlatform } from '../../shared/platform-capabilities';
import type { MediaKind, StreamScene, StreamSource } from '../../shared/desktop-api';
import { sourceAvailabilityDescription, type SourceStatus } from '../source-availability';
import './sources-dock.css';

const RENAME_MIN_LENGTH = 1;
const RENAME_MAX_LENGTH = 120;

// Pointer movement (px) a row must travel before a press becomes a drag
// rather than a click (matches scenes-dock.tsx).
const DRAG_THRESHOLD = 4;

interface SourceLocation {
  source: StreamSource;
  siblings: StreamSource[];
  index: number;
  /** The containing group's id, or `null` for a top-level (scene-root) source. */
  parentId: string | null;
}

/** Finds a source anywhere in the tree (including inside groups), with its siblings, index and parent id. */
function locateSource(nodes: StreamSource[], id: string, parentId: string | null = null): SourceLocation | null {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) return { source: nodes[index]!, siblings: nodes, index, parentId };
  for (const node of nodes) {
    if (node.kind === 'group') {
      const found = locateSource(node.children ?? [], id, node.id);
      if (found) return found;
    }
  }
  return null;
}

/** True when the event originated on a button or input inside the row, which should not start a drag/open the panel. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.('button, input');
}

interface SourceDragState {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
  /** The dragged row's parent id — drops are only valid among these same siblings. */
  parentId: string | null;
  /** The dragged row's sibling ids in storage order (back-to-front). */
  storageIds: string[];
  /** The same siblings in display order (top-to-bottom, front-most first). */
  displayIds: string[];
  movingIds: string[];
}

interface SourceDropIndicator {
  parentId: string | null;
  /** Display-order index (0..siblings.length) where the drop-indicator line sits. */
  displayIndex: number;
}

/** Row ids in the exact top-to-bottom order they render in, respecting collapsed groups. */
function visibleSourceIds(nodes: StreamSource[], collapsedGroupIds: string[]): string[] {
  const ids: string[] = [];
  for (const source of [...nodes].reverse()) {
    ids.push(source.id);
    if (source.kind === 'group' && !collapsedGroupIds.includes(source.id)) {
      ids.push(...visibleSourceIds(source.children ?? [], collapsedGroupIds));
    }
  }
  return ids;
}

function clampSourceName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < RENAME_MIN_LENGTH || trimmed.length > RENAME_MAX_LENGTH) return null;
  return trimmed;
}

export interface SourcesDockProps {
  style?: CSSProperties;
  resizer?: ReactNode;
  onHide: () => void;
  sources: StreamSource[];
  selectedSource: StreamSource | null;
  selectedSourceIds: string[];
  collapsedGroupIds: string[];
  setCollapsedGroupIds: Dispatch<SetStateAction<string[]>>;
  meterLevels: Record<string, number>;
  /** Current capture/media readiness, keyed by stable source ID. Ready entries are not shown. */
  sourceStatuses?: Readonly<Record<string, SourceStatus>>;
  onSelectSourceRow: (event: SelectionModifiers & { type?: string }, sourceId: string) => void;
  onSelectAllSources?: () => void;
  onClearSourceSelection?: () => void;
  onToggleSourceLock: (sourceId: string) => void;
  onMoveSource: (sourceId: string, direction: -1 | 1) => void;
  onUpdateSource: (sourceId: string, update: (source: StreamSource) => StreamSource) => void;

  /** Platform for shortcut-key labels in the right-click menu (e.g. "F" vs "⌘F"). Defaults to 'win32' labels when omitted. */
  platform?: StreamPlatform;
  /** Opens the source's properties. When omitted, the context menu's "Properties" item just selects the row. */
  onOpenSourceProperties?: (sourceId: string) => void;
  /** Opens the source's filters. When omitted, the context menu's "Filters" item just selects the row. */
  onOpenSourceFilters?: (sourceId: string) => void;
  /** Moves a source to the top/bottom of its sibling stack. When omitted, falls back to repeated single-step moves. */
  onMoveSourceTo?: (sourceId: string, position: 'top' | 'bottom') => void;
  /**
   * Persists a new sibling order after a pointer-drag reorder. `parentId` is
   * the containing group's id, or `null` for a top-level (scene-root) source;
   * `orderedIds` is the *complete* new sibling list in storage order
   * (back-to-front, i.e. the same order as `scene.sources` / a group's
   * `children` — the reverse of the displayed, top-to-bottom row order). When
   * omitted, falls back to repeated `onMoveSource` single-step calls computed
   * from the index delta, so dragging still works before this is wired up.
   */
  onReorderSources?: (parentId: string | null, orderedIds: string[]) => void;

  sourceMenuTriggerRef: { current: HTMLButtonElement | null };
  sourceMenuOpen: boolean;
  setSourceMenuOpen: Dispatch<SetStateAction<boolean>>;
  sourceActionsTriggerRef: { current: HTMLButtonElement | null };
  sourceActionsMenuOpen: boolean;
  setSourceActionsMenuOpen: Dispatch<SetStateAction<boolean>>;

  sourceActions: {
    sourceClipboardAvailable: boolean;
    working: boolean;
    canGroupSelectedSources: boolean;
    onCopySource: (sourceId?: string) => void;
    onPasteSource: () => void;
    onGroupSources: () => void;
    onUngroupSource: (sourceId?: string) => void;
    onFitSource: (source: StreamSource) => void;
    onCenterSource: (source: StreamSource) => void;
    onStretchSource: (source: StreamSource) => void;
    onResetTransform: (source: StreamSource) => void;
    onRemoveSelectedSource: () => void;
  };

  addSourceMenu: {
    onAddNdi?: () => void;
    desktopAudioMode: DesktopAudioCaptureMode;
    applicationAudioSupported: boolean;
    onOpenCapturePicker: (kind: 'screen' | 'window' | 'audio', targetSourceId?: string) => void;
    onAddSystemAudioCapture: (targetSourceId?: string) => void;
    onOpenApplicationAudioPicker: (targetSourceId?: string) => void;
    onAddCamera: () => void;
    onAddMicrophone: () => void;
    onAddMedia: (kind: MediaKind) => void;
    onAddSlideshow: () => void;
    onAddPresentation: () => void;
    onOpenBrowserDialog: () => void;
    onAddText: () => void;
    onAddColor: () => void;
    referenceableScenes: StreamScene[];
    onAddSceneReference: (scene: StreamScene) => void;
  };

  properties: Omit<SourcePropertiesProps, 'source'>;
}

export function SourcesDock({
  style,
  resizer,
  onHide,
  sources,
  selectedSource,
  selectedSourceIds,
  collapsedGroupIds,
  setCollapsedGroupIds,
  meterLevels,
  sourceStatuses,
  onSelectSourceRow,
  onSelectAllSources,
  onClearSourceSelection,
  onToggleSourceLock,
  onMoveSource,
  onUpdateSource,
  platform,
  onOpenSourceProperties,
  onOpenSourceFilters,
  onMoveSourceTo,
  onReorderSources,
  sourceMenuTriggerRef,
  sourceMenuOpen,
  setSourceMenuOpen,
  sourceActionsTriggerRef,
  sourceActionsMenuOpen,
  setSourceActionsMenuOpen,
  sourceActions,
  addSourceMenu,
  properties,
}: SourcesDockProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [contextSourceId, setContextSourceId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<SourceDropIndicator | null>(null);
  const [propertiesOpenForId, setPropertiesOpenForId] = useState<string | null>(null);
  const [lastSelectedSourceId, setLastSelectedSourceId] = useState<string | null>(selectedSource?.id ?? null);
  const contextMenu = usePointContextMenu();
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const skipRenameBlurRef = useRef(false);
  const dragStateRef = useRef<SourceDragState | null>(null);
  const didDragRef = useRef(false);
  // Read by the window `pointerup` listener below, which is attached once per
  // `sources`/`onReorderSources`/`onMoveSource` change (not per drag frame) and
  // so can't close over a fresh `dropIndicator` from render (mirrors
  // scenes-dock.tsx's `dropIndexRef`).
  const dropIndicatorRef = useRef(dropIndicator);
  dropIndicatorRef.current = dropIndicator;

  const shortcutPlatform: StreamPlatform = platform ?? 'win32';
  const orderedVisibleIds = visibleSourceIds(sources, collapsedGroupIds);
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selectedSourceIds.length,
    selectAll: onSelectAllSources ?? (() => {}),
    clearSelection: onClearSourceSelection ?? (() => {}),
  });
  const currentFocusId = focusedId && orderedVisibleIds.includes(focusedId)
    ? focusedId
    : (selectedSource && orderedVisibleIds.includes(selectedSource.id) ? selectedSource.id : (orderedVisibleIds[0] ?? null));
  const contextLocation = contextSourceId ? locateSource(sources, contextSourceId) : null;

  // Properties only open via an explicit action (a row double-click or a
  // menu's Properties/Filters item — see `showSourceProperties`/`showSourceFilters`).
  // Selecting a different source than the one it was opened for closes it, so
  // re-selecting that original source later doesn't silently reopen it.
  const selectedSourceId = selectedSource?.id ?? null;
  if (selectedSourceId !== lastSelectedSourceId) {
    if (propertiesOpenForId !== null && propertiesOpenForId === lastSelectedSourceId) setPropertiesOpenForId(null);
    setLastSelectedSourceId(selectedSourceId);
  }
  const propertiesOpen = selectedSource !== null && propertiesOpenForId === selectedSource.id;

  const selectPlain = (sourceId: string) => {
    const fakeEvent = { ctrlKey: false, metaKey: false, shiftKey: false, type: 'keyboard' };
    onSelectSourceRow(fakeEvent, sourceId);
  };

  const showSourceProperties = (sourceId: string) => {
    setPropertiesOpenForId(sourceId);
    if (onOpenSourceProperties) onOpenSourceProperties(sourceId);
    else selectPlain(sourceId);
  };

  const showSourceFilters = (sourceId: string) => {
    setPropertiesOpenForId(sourceId);
    if (onOpenSourceFilters) onOpenSourceFilters(sourceId);
    else selectPlain(sourceId);
  };

  const beginRename = (source: StreamSource) => {
    setFocusedId(source.id);
    setRenamingId(source.id);
    setRenameValue(source.name);
  };

  const commitRename = (source: StreamSource) => {
    const next = clampSourceName(renameValue);
    if (next && next !== source.name) onUpdateSource(source.id, (current) => ({ ...current, name: next }));
    setRenamingId(null);
  };

  const cancelRename = () => {
    skipRenameBlurRef.current = true;
    setRenamingId(null);
  };

  const handleRowContextMenu = (event: ReactMouseEvent<HTMLDivElement>, source: StreamSource) => {
    if (!selectedSourceIds.includes(source.id)) onSelectSourceRow(event, source.id);
    setFocusedId(source.id);
    setContextSourceId(source.id);
    contextMenu.show({ clientX: event.clientX, clientY: event.clientY, preventDefault: () => event.preventDefault() });
  };

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, source: StreamSource) => {
    if (renamingId) return;
    if (event.key === 'Escape' && dragStateRef.current) {
      event.preventDefault();
      event.stopPropagation();
      dragStateRef.current = null;
      setDragId(null);
      setDropIndicator(null);
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      beginRename(source);
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      const location = locateSource(sources, source.id);
      const displayIds = location ? [...location.siblings].reverse().map((sibling) => sibling.id) : [];
      const at = displayIds.indexOf(source.id);
      if (location && at >= 0) {
        const movingIds = selectedSourceIds.includes(source.id)
          ? selectedSourceIds.filter((id) => displayIds.includes(id))
          : [source.id];
        const movingPositions = displayIds.flatMap((id, index) => movingIds.includes(id) ? [index] : []);
        const edge = event.key === 'ArrowUp' ? Math.min(...movingPositions) : Math.max(...movingPositions);
        const targetAt = edge + (event.key === 'ArrowUp' ? -1 : 1);
        const nextDisplayIds = targetAt < 0 || targetAt >= displayIds.length
          ? displayIds
          : moveSelectedIds(displayIds, source.id, targetAt, new Set(movingIds));
        if (nextDisplayIds.join('|') !== displayIds.join('|')) {
          if (onReorderSources) onReorderSources(location.parentId, [...nextDisplayIds].reverse());
          else onMoveSource(source.id, event.key === 'ArrowUp' ? 1 : -1);
        }
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const at = orderedVisibleIds.indexOf(source.id);
      if (at < 0) return;
      const nextAt = event.key === 'ArrowDown' ? Math.min(at + 1, orderedVisibleIds.length - 1) : Math.max(at - 1, 0);
      const nextId = orderedVisibleIds[nextAt];
      if (nextId && nextId !== source.id) {
        setFocusedId(nextId);
        if (event.shiftKey) onSelectSourceRow(event, nextId);
        else selectPlain(nextId);
        rowRefs.current.get(nextId)?.focus();
      }
    }
  };

  const handleRowPointerDown = (event: ReactPointerEvent<HTMLDivElement>, source: StreamSource) => {
    if (event.button !== 0 || renamingId || isInteractiveTarget(event.target)) return;
    const location = locateSource(sources, source.id);
    if (!location) return;
    const storageIds = location.siblings.map((sibling) => sibling.id);
    dragStateRef.current = {
      id: source.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      parentId: location.parentId,
      storageIds,
      displayIds: [...storageIds].reverse(),
      movingIds: selectedSourceIds.includes(source.id)
        ? selectedSourceIds.filter((id) => storageIds.includes(id))
        : [source.id],
    };
  };

  const handleRowDoubleClick = (event: ReactMouseEvent<HTMLDivElement>, source: StreamSource) => {
    if (renamingId || isInteractiveTarget(event.target) || event.shiftKey || event.metaKey || event.ctrlKey) return;
    showSourceProperties(source.id);
  };

  // Pointer-drag reordering, mirroring scenes-dock.tsx's drag implementation.
  // A drop is only valid among the dragged row's own siblings (same parent
  // group, or both top-level) — dragging across parents shows no indicator
  // and drops nowhere, per the dock's tree-reordering scope.
  useEffect(() => {
    function computeDisplayIndex(displayIds: string[], clientY: number): number {
      for (let index = 0; index < displayIds.length; index += 1) {
        const row = rowRefs.current.get(displayIds[index]!);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return index;
      }
      return displayIds.length;
    }

    function nearestRowId(clientY: number): string | null {
      let bestId: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const [id, row] of rowRefs.current) {
        const rect = row.getBoundingClientRect();
        const distance = Math.abs(clientY - (rect.top + rect.height / 2));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestId = id;
        }
      }
      return bestId;
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
      const nearestId = nearestRowId(event.clientY);
      const nearestParentId = nearestId ? (locateSource(sources, nearestId)?.parentId ?? null) : null;
      if (nearestId === null || nearestParentId !== state.parentId) {
        setDropIndicator(null);
        return;
      }
      setDropIndicator({ parentId: state.parentId, displayIndex: computeDisplayIndex(state.displayIds, event.clientY) });
    }

    function handlePointerUp() {
      const state = dragStateRef.current;
      if (state?.active) {
        const indicator = dropIndicatorRef.current;
        if (indicator && indicator.parentId === state.parentId) {
          let nextStorageIds: string[];
          if (state.movingIds.length > 1) {
            nextStorageIds = [...moveSelectionToGap(state.displayIds, new Set(state.movingIds), indicator.displayIndex)].reverse();
          } else {
            nextStorageIds = reorderSourceSiblingsOnDrop(state.storageIds, state.id, indicator.displayIndex);
          }
          if (nextStorageIds.join('|') !== state.storageIds.join('|')) {
            if (onReorderSources) {
              onReorderSources(state.parentId, nextStorageIds);
            } else {
              const steps = fallbackSourceMoveSteps(state.storageIds, nextStorageIds, state.id);
              if (steps) for (let i = 0; i < steps.steps; i += 1) onMoveSource(state.id, steps.direction);
            }
          }
        }
        setDropIndicator(null);
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
        setDropIndicator(null);
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
  }, [sources, onReorderSources, onMoveSource]);

  const buildSourceMenuEntries = ({ source, siblings, index }: SourceLocation): MenuEntry[] => {
    const transformDisabled = !supportsSourceTransform(source) || !!source.locked;
    const atTop = index === siblings.length - 1;
    const atBottom = index === 0;
    const moveToTop = () => {
      if (onMoveSourceTo) { onMoveSourceTo(source.id, 'top'); return; }
      for (let i = index; i < siblings.length - 1; i += 1) onMoveSource(source.id, 1);
    };
    const moveToBottom = () => {
      if (onMoveSourceTo) { onMoveSourceTo(source.id, 'bottom'); return; }
      for (let i = index; i > 0; i -= 1) onMoveSource(source.id, -1);
    };
    return [
      { id: 'rename', label: 'Rename', shortcut: 'F2', onSelect: () => beginRename(source) },
      { id: 'remove', label: 'Remove', shortcut: 'Delete', danger: true, onSelect: sourceActions.onRemoveSelectedSource },
      { separator: true },
      { id: 'properties', label: 'Properties', onSelect: () => showSourceProperties(source.id) },
      { id: 'filters', label: 'Filters', onSelect: () => showSourceFilters(source.id) },
      { separator: true },
      {
        id: 'order',
        label: 'Order',
        children: [
          { id: 'order.up', label: 'Move Up', disabled: atTop, onSelect: () => onMoveSource(source.id, 1) },
          { id: 'order.down', label: 'Move Down', disabled: atBottom, onSelect: () => onMoveSource(source.id, -1) },
          { separator: true },
          { id: 'order.top', label: 'Move to Top', disabled: atTop, onSelect: moveToTop },
          { id: 'order.bottom', label: 'Move to Bottom', disabled: atBottom, onSelect: moveToBottom },
        ],
      },
      {
        id: 'transform',
        label: 'Transform',
        disabled: transformDisabled,
        children: [
          { id: 'transform.fit', label: 'Fit to Screen', shortcut: primaryShortcutLabel(shortcutPlatform, 'F'), onSelect: () => sourceActions.onFitSource(source) },
          { id: 'transform.stretch', label: 'Stretch to Screen', shortcut: primaryShortcutLabel(shortcutPlatform, 'S'), onSelect: () => sourceActions.onStretchSource(source) },
          { id: 'transform.center', label: 'Center to Screen', shortcut: primaryShortcutLabel(shortcutPlatform, 'D'), onSelect: () => sourceActions.onCenterSource(source) },
          { id: 'transform.reset', label: 'Reset Transform', shortcut: primaryShortcutLabel(shortcutPlatform, 'R'), onSelect: () => sourceActions.onResetTransform(source) },
        ],
      },
      { separator: true },
      { id: 'copy', label: 'Copy', shortcut: primaryShortcutLabel(shortcutPlatform, 'C'), onSelect: () => sourceActions.onCopySource(source.id) },
      { id: 'paste', label: 'Paste', shortcut: primaryShortcutLabel(shortcutPlatform, 'V'), disabled: !sourceActions.sourceClipboardAvailable || sourceActions.working, onSelect: sourceActions.onPasteSource },
      { separator: true },
      source.kind === 'group'
        ? { id: 'ungroup', label: 'Ungroup', onSelect: () => sourceActions.onUngroupSource(source.id) }
        : { id: 'group', label: 'Group Selected', disabled: !sourceActions.canGroupSelectedSources, onSelect: sourceActions.onGroupSources },
      { separator: true },
      { id: 'lock', label: source.locked ? 'Unlock' : 'Lock', checked: !!source.locked, onSelect: () => onToggleSourceLock(source.id) },
      { id: 'visibility', label: source.visible ? 'Hide' : 'Show', checked: source.visible, onSelect: () => onUpdateSource(source.id, (current) => ({ ...current, visible: !current.visible })) },
    ];
  };

  const sourceMenuEntries: MenuEntry[] = contextLocation ? buildSourceMenuEntries(contextLocation) : [];

  const renderSourceRows = (rows: StreamSource[], depth = 0, parentId: string | null = null): JSX.Element[] => {
    const displayIds = [...rows].reverse().map((node) => node.id);
    const isDropLevel = dropIndicator !== null && dropIndicator.parentId === parentId;
    const dropBeforeId = isDropLevel ? (displayIds[dropIndicator!.displayIndex] ?? null) : null;
    const dropAtEnd = isDropLevel && dropIndicator!.displayIndex === displayIds.length && displayIds.length > 0;

    return [...rows].reverse().map((source, displayIndex) => {
      const isGroup = source.kind === 'group';
      const collapsed = collapsedGroupIds.includes(source.id);
      const isLastDisplayed = displayIndex === rows.length - 1;
      const sourceStatus = sourceStatuses?.[source.id];
      const statusDescription = sourceStatus ? sourceAvailabilityDescription(source.name, sourceStatus) : null;
      return <div className="source-tree-node" key={source.id}>
        <div
          ref={(el) => { if (el) rowRefs.current.set(source.id, el); else rowRefs.current.delete(source.id); }}
          className={`source-row ${selectedSourceIds.includes(source.id) ? 'selected' : ''} ${source.locked ? 'source-locked' : ''} ${isGroup ? 'source-group-row' : ''} ${dragId === source.id ? 'source-dragging' : ''} ${dropBeforeId === source.id ? 'drag-over-before' : ''} ${isLastDisplayed && dropAtEnd ? 'drag-over-after' : ''}`}
          role="treeitem"
          aria-selected={selectedSourceIds.includes(source.id)}
          aria-level={depth + 1}
          aria-expanded={isGroup ? !collapsed : undefined}
          aria-description={statusDescription ?? undefined}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          tabIndex={source.id === currentFocusId ? 0 : -1}
          onClick={(event) => {
            if (didDragRef.current) { didDragRef.current = false; event.preventDefault(); return; }
            onSelectSourceRow(event, source.id);
            setFocusedId(source.id);
          }}
          onDoubleClick={(event) => handleRowDoubleClick(event, source)}
          onContextMenu={(event) => handleRowContextMenu(event, source)}
          onKeyDown={(event) => handleRowKeyDown(event, source)}
          onPointerDown={(event) => handleRowPointerDown(event, source)}
        >
          {isGroup ? <button className="group-expand-button" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${source.name}`} aria-expanded={!collapsed} onClick={(event) => {
            event.stopPropagation();
            setCollapsedGroupIds((current) => collapsed ? current.filter((id) => id !== source.id) : [...current, source.id]);
          }}>{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : null}
          <span className={`source-type-icon ${source.kind}`}>{sourceIcon(source.kind, source.mediaKind)}</span>
          {renamingId === source.id
            ? <input
                className="source-rename-input"
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') { event.preventDefault(); commitRename(source); }
                  else if (event.key === 'Escape') { event.preventDefault(); cancelRename(); }
                }}
                onBlur={() => {
                  if (skipRenameBlurRef.current) { skipRenameBlurRef.current = false; return; }
                  commitRename(source);
                }}
              />
            : <span className="source-label" onDoubleClick={(event) => { event.stopPropagation(); beginRename(source); }}>{source.name}</span>}
          {meterLevels[source.id] !== undefined && <span className="source-level-mini"><i style={{ width: `${Math.round((meterLevels[source.id] ?? 0) * 100)}%` }} /></span>}
          {statusDescription && sourceStatus && (sourceStatus.state === 'warning' || sourceStatus.state === 'unavailable') && <span
            className={`source-availability source-availability--${sourceStatus.state}`}
            role="img"
            aria-label={statusDescription}
            title={statusDescription}
          >
            {sourceStatus.state === 'warning' ? <TriangleAlert aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          </span>}
          <span className="source-actions">
            <ReacstButton.Icon variant="ghost" size="xs" label={`Visible ${source.name}`} tooltip={source.visible ? 'Hide source' : 'Show source'} pressed={source.visible} onClick={(event) => { event.stopPropagation(); onUpdateSource(source.id, (current) => ({ ...current, visible: !current.visible })); }}>
              {source.visible ? <Eye /> : <EyeOff />}
            </ReacstButton.Icon>
            <ReacstButton.Icon variant="ghost" size="xs" label={`Lock ${source.name}`} tooltip={source.locked ? 'Unlock source' : 'Lock source'} pressed={!!source.locked} onClick={(event) => { event.stopPropagation(); onToggleSourceLock(source.id); }}>{source.locked ? <Lock /> : <LockOpen />}</ReacstButton.Icon>
          </span>
        </div>
        {isGroup && !collapsed && <div className="source-children" role="group">{renderSourceRows(source.children ?? [], depth + 1, source.id)}</div>}
      </div>;
    });
  };

  const sourceActionsDropdown = (
    <DropdownMenu open={sourceActionsMenuOpen} onOpenChange={setSourceActionsMenuOpen} className="source-menu" side="top" align="end" sideOffset={6} label="Source actions"
      trigger={<button ref={sourceActionsTriggerRef} className="mini-icon" aria-label="More source actions"><MoreHorizontal size={16} /></button>}>
      <ContextMenu.Item disabled={!selectedSource} onSelect={() => { if (selectedSource) showSourceProperties(selectedSource.id); }}>Properties</ContextMenu.Item>
      <ContextMenu.Item disabled={!selectedSource} onSelect={() => { if (selectedSource) showSourceFilters(selectedSource.id); }}>Filters</ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item disabled={!selectedSource} onSelect={() => sourceActions.onCopySource()}><Copy size={14} />Copy Source</ContextMenu.Item>
      <ContextMenu.Item disabled={!sourceActions.sourceClipboardAvailable || sourceActions.working} onSelect={sourceActions.onPasteSource}><Plus size={14} />Paste Source</ContextMenu.Item>
      <ContextMenu.Separator />
      {selectedSource?.kind === 'group'
        ? <ContextMenu.Item onSelect={() => sourceActions.onUngroupSource()}><Layers2 size={14} />Ungroup</ContextMenu.Item>
        : <ContextMenu.Item disabled={!sourceActions.canGroupSelectedSources} onSelect={sourceActions.onGroupSources}><Layers2 size={14} />Group Sources</ContextMenu.Item>}
      <ContextMenu.Separator />
      <ContextMenu.Item disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onSelect={() => selectedSource && sourceActions.onFitSource(selectedSource)}><Move size={14} />Fit to Canvas</ContextMenu.Item>
      <ContextMenu.Item disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onSelect={() => selectedSource && sourceActions.onCenterSource(selectedSource)}><Move size={14} />Center</ContextMenu.Item>
      <ContextMenu.Item disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onSelect={() => selectedSource && sourceActions.onStretchSource(selectedSource)}><Move size={14} />Stretch to Canvas</ContextMenu.Item>
      <ContextMenu.Item disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onSelect={() => selectedSource && sourceActions.onResetTransform(selectedSource)}><Move size={14} />Reset Transform</ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item disabled={!selectedSource} onSelect={sourceActions.onRemoveSelectedSource}><X size={14} />Delete Source</ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item onSelect={onHide}>Hide Sources</ContextMenu.Item>
    </DropdownMenu>
  );
  const addSourceDropdown = (
    <DropdownMenu open={sourceMenuOpen} onOpenChange={setSourceMenuOpen} className="source-menu" align="end" sideOffset={6} label="Add source"
      trigger={<button ref={sourceMenuTriggerRef} className="mini-icon" aria-label="Add source"><Plus size={16} /></button>}>
      <div className="menu-label">Capture</div>
      <ContextMenu.Item onSelect={() => addSourceMenu.onOpenCapturePicker('screen')}><Monitor size={15} />Display Capture</ContextMenu.Item>
      <ContextMenu.Item onSelect={() => addSourceMenu.onOpenCapturePicker('window')}><Grid2X2 size={15} />Window Capture</ContextMenu.Item>
      {addSourceMenu.desktopAudioMode !== 'unavailable' && <ContextMenu.Item onSelect={() => addSourceMenu.desktopAudioMode === 'system-tap' ? addSourceMenu.onAddSystemAudioCapture() : addSourceMenu.onOpenCapturePicker('audio')}><Headphones size={15} />Audio Output Capture</ContextMenu.Item>}
      {addSourceMenu.applicationAudioSupported && <ContextMenu.Item onSelect={() => addSourceMenu.onOpenApplicationAudioPicker()}><Headphones size={15} />Application Audio Capture</ContextMenu.Item>}
      <ContextMenu.Item onSelect={addSourceMenu.onAddCamera}><Webcam size={15} />Video Capture Device</ContextMenu.Item>
      <ContextMenu.Item onSelect={addSourceMenu.onAddMicrophone}><Mic size={15} />Audio Input Capture</ContextMenu.Item>
      {addSourceMenu.onAddNdi && <ContextMenu.Item onSelect={addSourceMenu.onAddNdi}><Globe size={15} />NDI Source</ContextMenu.Item>}
      <div className="menu-label menu-label-separator">Media</div>
      <ContextMenu.Item onSelect={() => addSourceMenu.onAddMedia('image')}><ImageIcon size={15} />Image</ContextMenu.Item>
      <ContextMenu.Item onSelect={addSourceMenu.onAddSlideshow}><Images size={15} />Image Slideshow</ContextMenu.Item>
      <ContextMenu.Item onSelect={addSourceMenu.onAddPresentation}><Presentation size={15} />Presentation</ContextMenu.Item>
      <ContextMenu.Item onSelect={() => addSourceMenu.onAddMedia('video')}><FileVideo size={15} />Media Source</ContextMenu.Item>
      <ContextMenu.Item onSelect={() => addSourceMenu.onAddMedia('audio')}><FileAudio size={15} />Audio File</ContextMenu.Item>
      <ContextMenu.Item onSelect={addSourceMenu.onOpenBrowserDialog}><Globe size={15} />Browser Source</ContextMenu.Item>
      <div className="menu-label menu-label-separator">Graphics</div>
      <ContextMenu.Item onSelect={addSourceMenu.onAddText}><Type size={15} />Text</ContextMenu.Item>
      <ContextMenu.Item onSelect={addSourceMenu.onAddColor}><Layers2 size={15} />Color Source</ContextMenu.Item>
      {addSourceMenu.referenceableScenes.length > 0 && <>
        <div className="menu-label menu-label-separator">Composition</div>
        {addSourceMenu.referenceableScenes.map((scene) => <ContextMenu.Item key={scene.id} onSelect={() => addSourceMenu.onAddSceneReference(scene)}><PanelsTopLeft size={15} />{scene.name}</ContextMenu.Item>)}
      </>}
    </DropdownMenu>
  );

  return (
    <Panel density="compact" className="dock sources-dock" style={style}>
      {resizer}
      <DockHeader
        title="Sources"
        icon={<Layers />}
        onHide={onHide}
        actions={addSourceDropdown}
        menuTrigger={sourceActionsDropdown}
      />
      <div className="source-list" role="tree" aria-label="Sources" aria-multiselectable="true" onKeyDown={handleSelectionKeys}>
        {sources.length === 0 && (
          <EmptyState.Root>
            <EmptyState.Icon><Layers2 size={18} /></EmptyState.Icon>
            <EmptyState.Title>No sources yet</EmptyState.Title>
            <EmptyState.Description>Add a source to this scene.</EmptyState.Description>
          </EmptyState.Root>
        )}
        {renderSourceRows(sources)}
      </div>
      <PointContextMenu
        open={contextMenu.open}
        position={contextMenu.position}
        entries={sourceMenuEntries}
        label={contextLocation ? `${contextLocation.source.name} options` : 'Source options'}
        onClose={contextMenu.close}
      />
      {propertiesOpen && selectedSource && <Modal
        open
        title="Source Properties"
        className="source-properties-modal"
        onClose={() => setPropertiesOpenForId(null)}
      >
        <SourceProperties source={selectedSource} {...properties} />
      </Modal>}
    </Panel>
  );
}

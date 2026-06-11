import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import type { ElementUpdateInput, Id, TextElementPayload } from '@core/types';
import type { RichBody } from '@core/rich-text/types';
import { richBodyToText } from '@core/rich-text/serialize';
import { useElements } from '../../contexts/canvas/canvas-context';
import { resolveSnap, resolveTransformSnap } from './snap-guides';
import type { GuideLine, RenderScene } from './scene-types';
import { createDragSession, type DragSession } from './scene-stage-drag-session';
import { mapSnapBoxes } from './scene-stage-editor-utils';
import { useSceneStageShift } from './use-scene-stage-shift';
import { useSceneStageMarquee } from './use-scene-stage-marquee';
import { useSceneStageDraftBuffer } from './use-scene-stage-draft-buffer';
import { bindFixedClientRect } from './scene-node-bounds';

interface UseSceneStageEditorParams {
  scene: RenderScene;
  editable: boolean;
}

// A body is "rich" once any run carries an override or any block is a list.
// Multiple plain blocks (hard line breaks) are still plain — they round-trip
// through the `text` string.
function bodyIsRich(body: RichBody): boolean {
  return body.some(
    (block) =>
      block.listType !== undefined ||
      block.runs.some(
        (run) =>
          run.color !== undefined ||
          run.weight !== undefined ||
          run.italic !== undefined ||
          run.underline !== undefined ||
          run.strikethrough !== undefined,
      ),
  );
}

export function useSceneStageEditor({ scene, editable }: UseSceneStageEditorParams) {
  const {
    effectiveElements,
    baseElements,
    selectedElementIds,
    selectElements,
    toggleElementSelection,
    selectElement,
    clearSelection,
    setDraftElements,
    commitElementUpdates,
    setCanvasInteracting,
  } = useElements();

  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef<Map<Id, Konva.Group>>(new Map());
  const dragStartByIdRef = useRef<Map<Id, { x: number; y: number }>>(new Map());
  const dragSessionRef = useRef<DragSession | null>(null);

  const [guideLines, setGuideLines] = useState<GuideLine[]>([]);
  const [editingTextId, setEditingTextId] = useState<Id | null>(null);
  const shiftPressed = useSceneStageShift(editable);
  const selectedIdsSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const { applyDraftPatch, flushDraftBuffer } = useSceneStageDraftBuffer({ setDraftElements });
  const marquee = useSceneStageMarquee({
    editable,
    stageRef,
    nodeRefs,
    selectedElementIds,
    selectElements,
    clearSelection,
  });

  const setNodeRef = useCallback((id: Id, node: Konva.Group | null) => {
    if (!node) {
      nodeRefs.current.delete(id);
      return;
    }
    bindFixedClientRect(node);
    nodeRefs.current.set(id, node);
  }, []);

  useEffect(() => {
    if (!editable) return;
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes = selectedElementIds
      .map((id) => nodeRefs.current.get(id))
      .filter((node): node is Konva.Group => Boolean(node));
    transformer.nodes(nodes);
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, [editable, selectedElementIds]);

  const readNodeUpdate = useCallback((id: Id): ElementUpdateInput | null => {
    const node = nodeRefs.current.get(id);
    if (!node) return null;
    return {
      id,
      x: node.x(),
      y: node.y(),
      width: node.width(),
      height: node.height(),
      rotation: node.rotation(),
    };
  }, []);

  const commitSelectionFromNodes = useCallback(async () => {
    flushDraftBuffer();
    try {
      const updates = selectedElementIds
        .map((id) => readNodeUpdate(id))
        .filter((update): update is ElementUpdateInput => Boolean(update));
      await commitElementUpdates(updates);
    } finally {
      setCanvasInteracting(false);
    }
  }, [readNodeUpdate, commitElementUpdates, flushDraftBuffer, selectedElementIds, setCanvasInteracting]);

  const handleNodeSelect = useCallback((id: Id, toggle: boolean) => {
    if (!editable) return;
    if (toggle) toggleElementSelection(id);
    else selectElement(id);
  }, [editable, selectElement, toggleElementSelection]);

  const handleNodeDoubleClick = useCallback((id: Id) => {
    if (!editable) return;
    const element = effectiveElements.find((el) => el.id === id);
    if (!element || element.type !== 'text') return;
    selectElement(id);
    setEditingTextId(id);
  }, [editable, effectiveElements, selectElement]);

  // Drop the live-edit draft for an element so the canvas falls back to its
  // committed (base) payload.
  const clearTextDraft = useCallback((id: Id) => {
    setDraftElements((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, [setDraftElements]);

  // Live edit: push the in-progress body into the draft so the SAME canvas node
  // re-renders it as the user types. The editor renders no visible text of its
  // own — there is one render path (the canvas), so nothing shifts on enter/exit.
  const liveUpdateTextEdit = useCallback((body: RichBody) => {
    if (!editingTextId) return;
    const element = baseElements.find((el) => el.id === editingTextId);
    if (!element || element.type !== 'text') return;
    const payload = element.payload as TextElementPayload;
    const nextPayload: TextElementPayload = { ...payload, format: 'rich', richBody: body, text: richBodyToText(body) };
    applyDraftPatch(editingTextId, { payload: nextPayload });
  }, [editingTextId, baseElements, applyDraftPatch]);

  const commitTextEdit = useCallback(async (body: RichBody) => {
    if (!editingTextId) return;
    const targetId = editingTextId;
    // Compare against the BASE (persisted) payload, not the draft-merged one the
    // live edit already pushed, so we don't mistake the live preview for "no change".
    const element = baseElements.find((el) => el.id === targetId);
    if (!element || element.type !== 'text') {
      clearTextDraft(targetId);
      setEditingTextId(null);
      return;
    }
    const payload = element.payload as TextElementPayload;
    const text = richBodyToText(body);
    // Write-on-first-rich-edit: only persist a rich body when the user actually
    // applied a run override or a list; otherwise keep the element plain (text
    // only) so it stays byte-identical to before and lazy read-tolerance handles it.
    const rich = bodyIsRich(body);
    const nextPayload: TextElementPayload = rich
      ? { ...payload, format: 'rich', richBody: body, text }
      : { ...payload, format: 'plain', richBody: undefined, text };
    const changed = text !== payload.text
      || payload.format !== nextPayload.format
      || JSON.stringify(payload.richBody) !== JSON.stringify(nextPayload.richBody);
    if (changed) {
      await commitElementUpdates([{ id: targetId, payload: nextPayload }]);
    }
    clearTextDraft(targetId);
    setEditingTextId(null);
  }, [editingTextId, baseElements, commitElementUpdates, clearTextDraft]);

  const cancelTextEdit = useCallback(() => {
    if (editingTextId) clearTextDraft(editingTextId);
    setEditingTextId(null);
  }, [editingTextId, clearTextDraft]);

  const handleNodeDragStart = useCallback((id: Id) => {
    if (!editable) return;
    setCanvasInteracting(true);
    const nextSelection = selectedIdsSet.has(id) ? selectedElementIds : [id];
    const session = createDragSession(effectiveElements, nextSelection);
    selectElements(nextSelection);
    dragStartByIdRef.current.clear();
    for (const selectedId of nextSelection) {
      const element = session.elementById.get(selectedId);
      if (!element) continue;
      dragStartByIdRef.current.set(selectedId, { x: element.x, y: element.y });
    }
    dragSessionRef.current = session;
  }, [editable, effectiveElements, selectElements, selectedElementIds, selectedIdsSet, setCanvasInteracting]);

  const handleNodeDragMove = useCallback((id: Id) => {
    if (!editable) return;
    const node = nodeRefs.current.get(id);
    if (!node) return;
    const session = dragSessionRef.current;
    const selectedIds = session?.selectedSet.has(id) ? session.selectedIds : [id];
    const activeElement = session?.elementById.get(id) ?? effectiveElements.find((element) => element.id === id);
    if (!activeElement) return;

    const rawX = node.x();
    const rawY = node.y();

    const snap = resolveSnap(
      { id, x: rawX, y: rawY, width: activeElement.width, height: activeElement.height },
      session?.snapBoxes ?? mapSnapBoxes(effectiveElements, new Set(selectedIds)),
      scene.width,
      scene.height,
    );

    node.position({ x: snap.x, y: snap.y });
    setGuideLines(snap.guides);

    const anchorStart = dragStartByIdRef.current.get(id);
    if (!anchorStart) return;
    const dx = snap.x - anchorStart.x;
    const dy = snap.y - anchorStart.y;

    for (const selectedId of selectedIds) {
      const start = dragStartByIdRef.current.get(selectedId);
      if (!start) continue;
      applyDraftPatch(selectedId, { x: start.x + dx, y: start.y + dy });
    }
  }, [applyDraftPatch, editable, effectiveElements, scene.height, scene.width, selectedElementIds, selectedIdsSet]);

  const handleNodeDragEnd = useCallback(async () => {
    setGuideLines([]);
    dragSessionRef.current = null;
    await commitSelectionFromNodes();
  }, [commitSelectionFromNodes]);

  const handleNodeTransform = useCallback(() => {
    setCanvasInteracting(true);
    let nextGuides: GuideLine[] = [];
    const activeAnchor = transformerRef.current?.getActiveAnchor() ?? null;
    const canSnapTransform = activeAnchor !== null && activeAnchor !== 'rotater';

    for (const id of selectedElementIds) {
      const node = nodeRefs.current.get(id);
      if (!node) continue;
      const activeElement = effectiveElements.find((element) => element.id === id);
      if (!activeElement) continue;
      const shouldSnapTransform = canSnapTransform;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      let width = Math.max(1, node.width() * Math.abs(scaleX));
      let height = Math.max(1, node.height() * Math.abs(scaleY));
      let x = node.x();
      let y = node.y();

      if (shouldSnapTransform) {
        const snap = resolveTransformSnap(
          { id, x, y, width, height },
          mapSnapBoxes(effectiveElements, new Set(selectedElementIds)),
          scene.width,
          scene.height,
          activeAnchor,
        );
        x = snap.x;
        y = snap.y;
        width = snap.width;
        height = snap.height;
        nextGuides = snap.guides;
      }

      node.setAttrs({
        x,
        y,
        scaleX: scaleX < 0 ? -1 : 1,
        scaleY: scaleY < 0 ? -1 : 1,
        width,
        height,
        offsetX: scaleX < 0 ? width : 0,
        offsetY: scaleY < 0 ? height : 0,
      });

      for (const child of node.children ?? []) {
        if (activeElement.type === 'text' && !child.hasName('element-bounds')) {
          child.setAttrs({ width });
          continue;
        }
        child.setAttrs({ width, height });
      }

      applyDraftPatch(id, {
        x: node.x(),
        y: node.y(),
        width,
        height,
        rotation: node.rotation(),
      });
    }
    setGuideLines(nextGuides);
  }, [applyDraftPatch, effectiveElements, scene.height, scene.width, selectedElementIds, setCanvasInteracting]);

  const handleNodeTransformEnd = useCallback(async () => {
    setGuideLines([]);
    await commitSelectionFromNodes();
  }, [commitSelectionFromNodes]);

  return {
    stageRef,
    transformerRef,
    selectionBox: marquee.selectionBox,
    guideLines,
    shiftPressed,
    selectedIdsSet,
    editingTextId,
    effectiveElements,
    setNodeRef,
    handleNodeSelect,
    handleNodeDoubleClick,
    commitTextEdit,
    cancelTextEdit,
    liveUpdateTextEdit,
    handleNodeDragStart,
    handleNodeDragMove,
    handleNodeDragEnd,
    handleNodeTransform,
    handleNodeTransformEnd,
    handleStageMouseDown: marquee.handleStageMouseDown,
    handleStageMouseMove: marquee.handleStageMouseMove,
    handleStageMouseUp: marquee.handleStageMouseUp,
  };
}

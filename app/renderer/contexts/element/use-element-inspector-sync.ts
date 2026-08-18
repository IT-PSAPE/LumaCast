import { useEffect, useRef, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { ElementUpdateInput } from '@lumacast/protocol';
import type { ElementInspectorDraft } from '../../types/ui';
import { clamp } from '../../utils/slides';
import { hasGeometryChange, payloadSignature } from '../../utils/element-context-utils';

interface UseElementInspectorSyncInput {
  selectedElementId: Id | null;
  baseElements: SlideElement[];
  isCanvasInteracting: boolean;
  draftElements: Record<Id, Partial<SlideElement>>;
  setDraftElements: React.Dispatch<React.SetStateAction<Record<Id, Partial<SlideElement>>>>;
  saveElementUpdate: (input: ElementUpdateInput) => Promise<void>;
}

export function shouldApplyInspectorDraftPatch(isCanvasInteracting: boolean, draftOwnerElementId: Id | null, selectedElementId: Id | null): boolean {
  if (isCanvasInteracting) return false;
  if (!selectedElementId) return false;
  return draftOwnerElementId === selectedElementId;
}
export function shouldScheduleInspectorAutoSave(isCanvasInteracting: boolean, draftOwnerElementId: Id | null, selectedElementId: Id | null, elementPayloadDraft: SlideElement['payload'] | null): boolean {
  if (isCanvasInteracting) return false;
  if (!selectedElementId) return false;
  if (draftOwnerElementId !== selectedElementId) return false;
  if (!elementPayloadDraft) return false;
  if ('locked' in elementPayloadDraft && elementPayloadDraft.locked) return false;
  return true;
}
export function hasInspectorDraftDelta(baseElement: SlideElement, elementDraft: ElementInspectorDraft, elementPayloadDraft: SlideElement['payload'] | null): boolean {
  const payload = elementPayloadDraft ?? baseElement.payload;
  const payloadChanged = payloadSignature(baseElement.payload) !== payloadSignature(payload);
  const geometryChanged = hasGeometryChange(baseElement, elementDraft);
  return payloadChanged || geometryChanged;
}
function isInteractionSettling(lastCanvasInteractionEndRef: React.RefObject<number>): boolean { return Date.now() - (lastCanvasInteractionEndRef.current ?? 0) < 120; }
function hasMatchingInspectorDraft(current: ElementInspectorDraft | null, selectedElement: SlideElement): boolean {
  if (!current) return false;
  return (
    current.x === selectedElement.x &&
    current.y === selectedElement.y &&
    current.width === selectedElement.width &&
    current.height === selectedElement.height &&
    current.rotation === selectedElement.rotation &&
    current.opacity === selectedElement.opacity &&
    current.zIndex === selectedElement.zIndex
  );
}

export function useElementInspectorSync({
  selectedElementId,
  baseElements,
  isCanvasInteracting,
  draftElements,
  setDraftElements,
  saveElementUpdate,
}: UseElementInspectorSyncInput) {
  const [elementDraft, setElementDraft] = useState<ElementInspectorDraft | null>(null);
  const [elementPayloadDraft, setElementPayloadDraft] = useState<SlideElement['payload'] | null>(null);
  const [lockAspectRatio, setLockAspectRatio] = useState(false);
  const [draftOwnerElementId, setDraftOwnerElementId] = useState<Id | null>(null);

  const lastAutoSaveKeyRef = useRef('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousSelectedIdRef = useRef<Id | null>(null);
  const lastSelectedSyncKeyRef = useRef('');
  const wasCanvasInteractingRef = useRef(false);
  const lastCanvasInteractionEndRef = useRef(0);
  const selectedBaseElement = selectedElementId
    ? baseElements.find((element) => element.id === selectedElementId) ?? null
    : null;

  useEffect(() => {
    const wasCanvasInteracting = wasCanvasInteractingRef.current;
    wasCanvasInteractingRef.current = isCanvasInteracting;
    if (wasCanvasInteracting && !isCanvasInteracting) lastCanvasInteractionEndRef.current = Date.now();
    if (!isCanvasInteracting || !autoSaveTimerRef.current) return;
    clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null;
  }, [isCanvasInteracting]);

  useEffect(() => {
    if (!selectedBaseElement) {
      setElementDraft((current) => (current === null ? current : null));
      setElementPayloadDraft((current) => (current === null ? current : null));
      setDraftOwnerElementId((current) => (current === null ? current : null));
      previousSelectedIdRef.current = null;
      lastSelectedSyncKeyRef.current = '';
      return;
    }
    const selectionChanged = previousSelectedIdRef.current !== selectedBaseElement.id;
    const nextSyncKey = `${selectedBaseElement.id}|${selectedBaseElement.x}|${selectedBaseElement.y}|${selectedBaseElement.width}|${selectedBaseElement.height}|${selectedBaseElement.rotation}|${selectedBaseElement.opacity}|${selectedBaseElement.zIndex}|${payloadSignature(selectedBaseElement.payload)}`;
    if (!selectionChanged && (isCanvasInteracting || nextSyncKey === lastSelectedSyncKeyRef.current)) return;
    previousSelectedIdRef.current = selectedBaseElement.id;
    lastSelectedSyncKeyRef.current = nextSyncKey;
    setDraftOwnerElementId((current) => (current === selectedBaseElement.id ? current : selectedBaseElement.id));
    setElementDraft((current) => {
      if (hasMatchingInspectorDraft(current, selectedBaseElement)) return current;
      return {
        x: selectedBaseElement.x,
        y: selectedBaseElement.y,
        width: selectedBaseElement.width,
        height: selectedBaseElement.height,
        rotation: selectedBaseElement.rotation,
        opacity: selectedBaseElement.opacity,
        zIndex: selectedBaseElement.zIndex,
      };
    });
    setElementPayloadDraft((current) => {
      if (payloadSignature(current) === payloadSignature(selectedBaseElement.payload)) return current;
      return JSON.parse(JSON.stringify(selectedBaseElement.payload)) as SlideElement['payload'];
    });
    if (selectionChanged) setLockAspectRatio(false);
  }, [isCanvasInteracting, selectedBaseElement]);

  useEffect(() => {
    if (!selectedElementId || !elementDraft) return;
    if (!shouldApplyInspectorDraftPatch(isCanvasInteracting, draftOwnerElementId, selectedElementId)) return;
    if (isInteractionSettling(lastCanvasInteractionEndRef)) return;
    const base = baseElements.find((element) => element.id === selectedElementId);
    if (!base) return;
    if (!hasInspectorDraftDelta(base, elementDraft, elementPayloadDraft)) {
      setDraftElements((current) => {
        if (!(selectedElementId in current)) return current;
        const next = { ...current };
        delete next[selectedElementId];
        return next;
      });
      return;
    }
    setDraftElements((current) => {
      const existingPatch = current[selectedElementId] ?? {};
      const nextPayload = elementPayloadDraft ?? base.payload;
      const nextPatch: Partial<SlideElement> = {
        ...existingPatch,
        x: elementDraft.x,
        y: elementDraft.y,
        width: elementDraft.width,
        height: elementDraft.height,
        rotation: elementDraft.rotation,
        opacity: elementDraft.opacity,
        zIndex: elementDraft.zIndex,
        payload: nextPayload,
      };

      const unchanged =
        existingPatch.x === nextPatch.x &&
        existingPatch.y === nextPatch.y &&
        existingPatch.width === nextPatch.width &&
        existingPatch.height === nextPatch.height &&
        existingPatch.rotation === nextPatch.rotation &&
        existingPatch.opacity === nextPatch.opacity &&
        existingPatch.zIndex === nextPatch.zIndex &&
        payloadSignature((existingPatch.payload as SlideElement['payload'] | undefined) ?? null) ===
          payloadSignature((nextPatch.payload as SlideElement['payload'] | undefined) ?? null);

      if (unchanged) return current;
      return { ...current, [selectedElementId]: nextPatch };
    });
  }, [baseElements, draftOwnerElementId, elementDraft, elementPayloadDraft, isCanvasInteracting, selectedElementId, setDraftElements]);
  useEffect(() => {
    if (!elementDraft) return;
    if (isInteractionSettling(lastCanvasInteractionEndRef)) return;
    if (!shouldScheduleInspectorAutoSave(isCanvasInteracting, draftOwnerElementId, selectedElementId, elementPayloadDraft)) return;
    if (!selectedElementId || !elementPayloadDraft) return;
    const base = baseElements.find((element) => element.id === selectedElementId);
    if (!base) return;
    const payloadChanged = payloadSignature(base.payload) !== payloadSignature(elementPayloadDraft);
    const geometryChanged = hasGeometryChange(base, elementDraft);
    if (!payloadChanged && !geometryChanged) return;
    const saveKey = `${selectedElementId}|${elementDraft.x}|${elementDraft.y}|${elementDraft.width}|${elementDraft.height}|${elementDraft.rotation}|${elementDraft.opacity}|${elementDraft.zIndex}|${payloadSignature(elementPayloadDraft)}`;
    if (saveKey === lastAutoSaveKeyRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const capturedKey = saveKey;
    const capturedDraft = { ...elementDraft };
    const capturedPayload = elementPayloadDraft;
    const capturedId = selectedElementId;
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      lastAutoSaveKeyRef.current = capturedKey;
      void saveElementUpdate({
        id: capturedId,
        x: capturedDraft.x,
        y: capturedDraft.y,
        width: Math.max(1, capturedDraft.width),
        height: Math.max(1, capturedDraft.height),
        rotation: capturedDraft.rotation,
        opacity: clamp(capturedDraft.opacity, 0, 1),
        zIndex: Math.round(capturedDraft.zIndex),
        payload: capturedPayload,
      });
    }, 120);
    return () => {
      if (!autoSaveTimerRef.current) return;
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    };
  }, [baseElements, draftOwnerElementId, elementDraft, elementPayloadDraft, isCanvasInteracting, saveElementUpdate, selectedElementId]);
  return {
    draftElements,
    elementDraft,
    elementPayloadDraft,
    lockAspectRatio,
    setElementDraft,
    setElementPayloadDraft,
    setLockAspectRatio,
  };
}

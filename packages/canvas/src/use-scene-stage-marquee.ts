import { useCallback, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Id } from '@lumacast/kernel';
import { collectMarqueeHits, normalizeRect, type SelectionBox } from './scene-stage-editor-utils';

interface UseSceneStageMarqueeParams {
  editable: boolean;
  stageRef: React.RefObject<Konva.Stage | null>;
  nodeRefs: React.RefObject<Map<Id, Konva.Group>>;
  selectedElementIds: Id[];
  selectElements: (ids: Id[]) => void;
  clearSelection: () => void;
}

export function useSceneStageMarquee({ editable, stageRef, nodeRefs, selectedElementIds, selectElements, clearSelection }: UseSceneStageMarqueeParams) {
  const marqueeStartRef = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  const handleStageMouseDown = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!editable) return;
    const isStageTarget = event.target === event.target.getStage();
    const isLayerTarget = event.target.getClassName() === 'Layer';
    const isRootGroupTarget = event.target.hasName('scene-root');
    if (!isStageTarget && !isLayerTarget && !isRootGroupTarget) return;
    const point = event.target.getStage()?.getPointerPosition();
    if (!point) return;
    marqueeStartRef.current = { x: point.x, y: point.y, additive: event.evt.shiftKey };
    setSelectionBox({ x: point.x, y: point.y, width: 0, height: 0 });
    if (!event.evt.shiftKey) clearSelection();
  }, [clearSelection, editable]);

  const handleStageMouseMove = useCallback(() => {
    const start = marqueeStartRef.current;
    if (!editable || !start) return;
    const point = stageRef.current?.getPointerPosition();
    if (!point) return;
    setSelectionBox({ x: start.x, y: start.y, width: point.x - start.x, height: point.y - start.y });
  }, [editable, stageRef]);

  const handleStageMouseUp = useCallback(() => {
    const start = marqueeStartRef.current;
    if (!editable || !start) return;
    const stage = stageRef.current;
    const rect = selectionBox ? normalizeRect(selectionBox) : null;
    marqueeStartRef.current = null;
    setSelectionBox(null);

    if (!stage || !rect || rect.width < 4 || rect.height < 4) return;

    const hitIds = collectMarqueeHits(nodeRefs.current, rect);
    if (start.additive) {
      selectElements(Array.from(new Set([...selectedElementIds, ...hitIds])));
      return;
    }

    selectElements(hitIds);
  }, [editable, nodeRefs, selectElements, selectedElementIds, selectionBox, stageRef]);

  return {
    selectionBox,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
  };
}

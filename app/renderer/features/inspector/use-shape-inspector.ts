import { applyVisualPayload, readVisualPayload, type VisualPayloadState } from '@lumacast/composition';
import { parseNumber } from '../../utils/slides';
import { useElements, useRenderScenes } from '../../contexts/canvas/canvas-context';
import { alignElementDraft } from '../canvas/align-element-draft';
import type { ElementInspectorDraft } from '../../types/ui';

interface ShapeInspectorState {
  elementDraft: ElementInspectorDraft;
  visual: VisualPayloadState;
  styleLabelPrefix: string;
  locked: boolean;
}

interface ShapeInspectorActions {
  handleXChange: (value: string) => void;
  handleYChange: (value: string) => void;
  handleWChange: (value: string) => void;
  handleHChange: (value: string) => void;
  handleRotationChange: (value: string) => void;
  handleOpacityChange: (value: string) => void;
  handleAlignLeft: () => void;
  handleAlignCenter: () => void;
  handleAlignRight: () => void;
  handleAlignTop: () => void;
  handleAlignMiddle: () => void;
  handleAlignBottom: () => void;
  handleFlipX: () => void;
  handleFlipY: () => void;
  handleFillToggle: (enabled: boolean) => void;
  handleFillColorChange: (value: string) => void;
  updateVisual: (patch: Partial<VisualPayloadState>) => void;
}

export type ShapeInspectorResult = { state: ShapeInspectorState; actions: ShapeInspectorActions } | null;

export function useShapeInspector(): ShapeInspectorResult {
  const {
    selectedElement,
    elementDraft,
    elementPayloadDraft,
    lockAspectRatio,
    setElementDraft,
    setElementPayloadDraft,
  } = useElements();
  const { editScene } = useRenderScenes();

  if (!selectedElement || !elementDraft || !elementPayloadDraft) return null;

  const activeElement = selectedElement;
  const activePayload = elementPayloadDraft;
  const visual = readVisualPayload(activeElement.type, activePayload);
  const styleLabelPrefix = activeElement.type === 'text' ? 'Box ' : '';

  function updateDraft(transform: (current: ElementInspectorDraft) => ElementInspectorDraft) {
    setElementDraft((current) => (current ? transform(current) : current));
  }

  function updateVisual(patch: Partial<VisualPayloadState>) {
    const nextVisual = { ...readVisualPayload(activeElement.type, activePayload), ...patch };
    setElementPayloadDraft(applyVisualPayload(activeElement.type, activePayload, nextVisual));
  }

  function handleXChange(value: string) { updateDraft((current) => ({ ...current, x: parseNumber(value, current.x) })); }
  function handleYChange(value: string) { updateDraft((current) => ({ ...current, y: parseNumber(value, current.y) })); }
  function handleWChange(value: string) {
    updateDraft((current) => {
      const nextWidth = Math.max(1, parseNumber(value, current.width));
      if (!lockAspectRatio || current.height <= 0) return { ...current, width: nextWidth };
      const ratio = current.width / current.height || 1;
      return { ...current, width: nextWidth, height: Math.max(1, nextWidth / ratio) };
    });
  }
  function handleHChange(value: string) {
    updateDraft((current) => {
      const nextHeight = Math.max(1, parseNumber(value, current.height));
      if (!lockAspectRatio || current.width <= 0) return { ...current, height: nextHeight };
      const ratio = current.width / current.height || 1;
      return { ...current, height: nextHeight, width: Math.max(1, nextHeight * ratio) };
    });
  }
  function handleRotationChange(value: string) { updateDraft((current) => ({ ...current, rotation: parseNumber(value, current.rotation) })); }
  function handleOpacityChange(value: string) {
    updateDraft((current) => ({ ...current, opacity: Math.max(0, Math.min(1, parseNumber(value, current.opacity * 100) / 100)) }));
  }
  function handleAlignLeft() { updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'left')); }
  function handleAlignCenter() { updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'center')); }
  function handleAlignRight() { updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'right')); }
  function handleAlignTop() { updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'top')); }
  function handleAlignMiddle() { updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'middle')); }
  function handleAlignBottom() { updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'bottom')); }
  function handleFlipX() { updateVisual({ flipX: !visual.flipX }); }
  function handleFlipY() { updateVisual({ flipY: !visual.flipY }); }
  function handleFillToggle(enabled: boolean) { updateVisual({ fillEnabled: enabled }); }
  function handleFillColorChange(value: string) { updateVisual({ fillColor: value }); }

  return {
    state: {
      elementDraft,
      visual,
      styleLabelPrefix,
      locked: visual.locked,
    },
    actions: {
      handleXChange,
      handleYChange,
      handleWChange,
      handleHChange,
      handleRotationChange,
      handleOpacityChange,
      handleAlignLeft,
      handleAlignCenter,
      handleAlignRight,
      handleAlignTop,
      handleAlignMiddle,
      handleAlignBottom,
      handleFlipX,
      handleFlipY,
      handleFillToggle,
      handleFillColorChange,
      updateVisual,
    },
  };
}

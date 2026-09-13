import { applyVisualPayload, readMediaFit, readVisualPayload, type ImageElementPayload, type SlideBackgroundFit, type VisualPayloadState } from '@lumacast/composition';
import { parseNumber } from '../../utils/slides';
import { useElements, useRenderScenes } from '../../contexts/canvas/canvas-context';
import { alignElementDraft } from '../canvas/align-element-draft';
import type { ElementInspectorDraft } from '../../types/ui';

interface ShapeInspectorState {
  elementDraft: ElementInspectorDraft;
  visual: VisualPayloadState;
  styleLabelPrefix: string;
  locked: boolean;
  lockAspectRatio: boolean;
  /** The image element's fit, or null when the selected element isn't an image (media fit lives on video's own tab). */
  mediaFit: SlideBackgroundFit | null;
  /** ≥2 elements selected: the Position align row acts on the selection instead of the single element. */
  isMultiSelection: boolean;
}

interface ShapeInspectorActions {
  handleXChange: (value: string) => void;
  handleYChange: (value: string) => void;
  handleWChange: (value: string) => void;
  handleHChange: (value: string) => void;
  handleRotationChange: (value: string) => void;
  handleOpacityChange: (value: string) => void;
  handleResetRotation: () => void;
  handleToggleLockAspectRatio: () => void;
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
  handleMediaFitChange: (value: SlideBackgroundFit) => void;
  updateVisual: (patch: Partial<VisualPayloadState>) => void;
}

export type ShapeInspectorResult = { state: ShapeInspectorState; actions: ShapeInspectorActions } | null;

export function useShapeInspector(): ShapeInspectorResult {
  const {
    selectedElement,
    selectedElementIds,
    elementDraft,
    elementPayloadDraft,
    lockAspectRatio,
    setElementDraft,
    setElementPayloadDraft,
    setLockAspectRatio,
    alignSelection,
  } = useElements();
  const { editScene } = useRenderScenes();
  const isMultiSelection = selectedElementIds.length >= 2;

  if (!selectedElement || !elementDraft || !elementPayloadDraft) return null;

  const activeElement = selectedElement;
  const activePayload = elementPayloadDraft;
  const visual = readVisualPayload(activeElement.type, activePayload);
  const styleLabelPrefix = activeElement.type === 'text' ? 'Box ' : '';
  // Video already has its own Fit select on the Video tab; this generic Shape
  // tab is the only place an image element's inspector renders, so it is
  // where the image Fit control belongs (task #223 audit item 2).
  const mediaFit = activeElement.type === 'image' ? readMediaFit('image', activePayload as ImageElementPayload) : null;

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
  function handleResetRotation() { updateDraft((current) => ({ ...current, rotation: 0 })); }
  function handleOpacityChange(value: string) {
    updateDraft((current) => ({ ...current, opacity: Math.max(0, Math.min(1, parseNumber(value, current.opacity * 100) / 100)) }));
  }
  function handleToggleLockAspectRatio() { setLockAspectRatio((current) => !current); }
  function handleAlignLeft() {
    if (isMultiSelection) { void alignSelection('left', 'selection'); return; }
    updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'left'));
  }
  function handleAlignCenter() {
    if (isMultiSelection) { void alignSelection('centerX', 'selection'); return; }
    updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'center'));
  }
  function handleAlignRight() {
    if (isMultiSelection) { void alignSelection('right', 'selection'); return; }
    updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'right'));
  }
  function handleAlignTop() {
    if (isMultiSelection) { void alignSelection('top', 'selection'); return; }
    updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'top'));
  }
  function handleAlignMiddle() {
    if (isMultiSelection) { void alignSelection('centerY', 'selection'); return; }
    updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'middle'));
  }
  function handleAlignBottom() {
    if (isMultiSelection) { void alignSelection('bottom', 'selection'); return; }
    updateDraft((current) => alignElementDraft(current, editScene.width, editScene.height, 'bottom'));
  }
  function handleFlipX() { updateVisual({ flipX: !visual.flipX }); }
  function handleFlipY() { updateVisual({ flipY: !visual.flipY }); }
  function handleFillToggle(enabled: boolean) { updateVisual({ fillEnabled: enabled }); }
  function handleFillColorChange(value: string) { updateVisual({ fillColor: value }); }
  function handleMediaFitChange(value: SlideBackgroundFit) {
    if (activeElement.type !== 'image') return;
    setElementPayloadDraft({ ...(activePayload as ImageElementPayload), fit: value } satisfies ImageElementPayload);
  }

  return {
    state: {
      elementDraft,
      visual,
      styleLabelPrefix,
      locked: visual.locked,
      lockAspectRatio,
      mediaFit,
      isMultiSelection,
    },
    actions: {
      handleXChange,
      handleYChange,
      handleWChange,
      handleHChange,
      handleRotationChange,
      handleOpacityChange,
      handleResetRotation,
      handleToggleLockAspectRatio,
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
      handleMediaFitChange,
      updateVisual,
    },
  };
}

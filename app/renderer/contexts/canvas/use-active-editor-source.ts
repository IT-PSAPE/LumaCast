import { useMemo } from 'react';
import { overlayToLayerElements } from '@core/presentation-layers';
import type { SlideElement } from '@core/types';
import { useNavigation } from '../navigation-context';
import { useSlides } from '../slide-context';
import { useOverlayEditor, useDeckEditor, useStageEditor, useThemeEditor } from '../asset-editor/asset-editor-context';
import { useWorkbench } from '../workbench-context';
import type { ActiveEditorSource, EditorCreateCapabilities } from './editor-source';

const NOOP_CREATE_CAPABILITIES: EditorCreateCapabilities = {
  text: false,
  shape: false,
  image: false,
  video: false,
};

function noopReplaceElements(_elements: SlideElement[]) {}

export function useActiveEditorSource(): ActiveEditorSource {
  const { currentDeckItem } = useNavigation();
  const { currentSlide } = useSlides();
  const { currentOverlay, updateOverlayDraft } = useOverlayEditor();
  const { getSlideElements, replaceSlideElements } = useDeckEditor();
  const { currentTheme, replaceThemeElements } = useThemeEditor();
  const { currentStage, replaceStageElements } = useStageEditor();
  const { state: { workbenchMode } } = useWorkbench();

  return useMemo<ActiveEditorSource>(() => {
    if (workbenchMode === 'deck-editor') {
      return {
        mode: workbenchMode,
        entityId: currentSlide?.id ?? null,
        hasSource: Boolean(currentSlide),
        frame: currentSlide,
        elements: currentSlide ? getSlideElements(currentSlide.id) : [],
        replaceElements: (elements) => {
          if (!currentSlide) return;
          replaceSlideElements(currentSlide.id, elements);
        },
        historyKey: currentSlide?.id ?? null,
        emptyStateLabel: 'No slide selected.',
        editable: true,
        createCapabilities: {
          text: currentDeckItem?.type !== 'lyric',
          shape: true,
          image: true,
          video: true,
        },
        meta: {
          slide: currentSlide,
          slideId: currentSlide?.id ?? null,
          deckItemType: currentDeckItem?.type ?? null,
        },
      };
    }

    if (workbenchMode === 'overlay-editor') {
      return {
        mode: workbenchMode,
        entityId: currentOverlay?.id ?? null,
        hasSource: Boolean(currentOverlay),
        // `null` falls back to the full output canvas in `buildRenderScene`
        // (LAYER_PREVIEW_SLIDE = 1920×1080). Overlay elements are positioned
        // in output-canvas coordinates via `overlayToLayerElements`, so the
        // editor needs the full stage as its frame — using the overlay's own
        // width/height instead would shrink the canvas to the overlay's
        // bounding box and break the editing view.
        frame: null,
        elements: currentOverlay ? overlayToLayerElements(currentOverlay) : [],
        replaceElements: (elements) => {
          if (!currentOverlay) return;
          updateOverlayDraft({ id: currentOverlay.id, elements });
        },
        historyKey: currentOverlay?.id ?? null,
        emptyStateLabel: 'No overlay selected.',
        editable: true,
        createCapabilities: {
          text: true,
          shape: true,
          image: true,
          video: true,
        },
        meta: {
          overlay: currentOverlay,
        },
      };
    }

    if (workbenchMode === 'theme-editor') {
      return {
        mode: workbenchMode,
        entityId: currentTheme?.id ?? null,
        hasSource: Boolean(currentTheme),
        frame: currentTheme ? { width: currentTheme.width, height: currentTheme.height } : null,
        elements: currentTheme?.elements ?? [],
        replaceElements: (elements) => {
          replaceThemeElements(elements);
        },
        historyKey: currentTheme?.id ?? null,
        emptyStateLabel: 'No theme selected.',
        editable: true,
        createCapabilities: {
          text: currentTheme?.kind !== 'lyrics',
          shape: true,
          image: true,
          video: true,
        },
        meta: {
          theme: currentTheme,
          themeKind: currentTheme?.kind ?? null,
        },
      };
    }

    if (workbenchMode === 'stage-editor') {
      return {
        mode: workbenchMode,
        entityId: currentStage?.id ?? null,
        hasSource: Boolean(currentStage),
        frame: currentStage ? { width: currentStage.width, height: currentStage.height } : null,
        elements: currentStage?.elements ?? [],
        replaceElements: (elements) => {
          replaceStageElements(elements);
        },
        historyKey: currentStage?.id ?? null,
        emptyStateLabel: 'No stage selected.',
        editable: true,
        createCapabilities: {
          text: true,
          shape: true,
          image: true,
          video: true,
        },
        meta: {
          stage: currentStage,
        },
      };
    }

    return {
      mode: workbenchMode,
      entityId: null,
      hasSource: false,
      frame: null,
      elements: [],
      replaceElements: noopReplaceElements,
      historyKey: null,
      emptyStateLabel: 'No editable source selected.',
      editable: false,
      createCapabilities: NOOP_CREATE_CAPABILITIES,
      meta: {},
    };
  }, [
    currentDeckItem?.type,
    currentOverlay,
    currentSlide,
    currentStage,
    currentTheme,
    getSlideElements,
    replaceSlideElements,
    replaceStageElements,
    replaceThemeElements,
    updateOverlayDraft,
    workbenchMode,
  ]);
}

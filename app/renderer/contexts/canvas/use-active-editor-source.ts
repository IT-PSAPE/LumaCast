import { useMemo } from 'react';
import { LAYER_PREVIEW_SLIDE, overlayToLayerElements } from '@lumacast/composition';
import type { SlideElement } from '@lumacast/composition';
import { useNavigation } from '../navigation-context';
import { useSlides } from '../slide-context';
import { useOverlayEditor, useDeckEditor, useStageEditor, useThemeEditor } from '../asset-editor/asset-editor-context';
import { useProjectContent } from '../use-project-content';
import { useWorkbench } from '../workbench-context';
import type { ActiveEditorSource, EditorCreateCapabilities } from '@lumacast/canvas';

const NOOP_CREATE_CAPABILITIES: EditorCreateCapabilities = {
  text: false,
  shape: false,
  image: false,
  video: false,
};
const EMPTY_EDITOR_ELEMENTS: SlideElement[] = [];

function noopReplaceElements(_elements: SlideElement[]) {}

export function useActiveEditorSource(): ActiveEditorSource {
  const { currentItemRef } = useNavigation();
  const { currentSlide } = useSlides();
  const { currentOverlay, updateOverlayDraft } = useOverlayEditor();
  const { getSlideElements, replaceSlideElements } = useDeckEditor();
  const { themeType, currentTheme, replaceThemeElements } = useThemeEditor();
  const { currentStage, replaceStageElements } = useStageEditor();
  const { presentationThemesById, lyricThemesById, talkThemesById, overlayThemesById, overlaysById, stagesById } = useProjectContent();
  const { state: { workbenchMode } } = useWorkbench();

  const themesById = themeType === 'lyric' ? lyricThemesById
    : themeType === 'talk' ? talkThemesById
    : themeType === 'overlay' ? overlayThemesById
    : presentationThemesById;

  return useMemo<ActiveEditorSource>(() => {
    if (workbenchMode === 'item-editor') {
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
          text: currentItemRef?.type !== 'lyric',
          shape: true,
          image: true,
          video: true,
        },
        meta: {
          slide: currentSlide,
          slideId: currentSlide?.id ?? null,
          itemType: currentItemRef?.type ?? null,
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
        frame: currentOverlay
          ? { width: LAYER_PREVIEW_SLIDE.width, height: LAYER_PREVIEW_SLIDE.height, background: overlaysById.get(currentOverlay.id)?.background ?? null }
          : null,
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
        frame: currentTheme
          ? { width: currentTheme.width, height: currentTheme.height, background: themesById.get(currentTheme.id)?.background ?? null }
          : null,
        elements: currentTheme?.elements ?? [],
        replaceElements: (elements) => {
          replaceThemeElements(elements);
        },
        historyKey: currentTheme?.id ?? null,
        emptyStateLabel: 'No theme selected.',
        editable: true,
        createCapabilities: {
          text: themeType !== 'lyric',
          shape: true,
          image: true,
          video: true,
        },
        meta: {
          theme: currentTheme,
          themeType: currentTheme ? themeType : null,
        },
      };
    }

    if (workbenchMode === 'stage-editor') {
      return {
        mode: workbenchMode,
        entityId: currentStage?.id ?? null,
        hasSource: Boolean(currentStage),
        frame: currentStage
          ? { width: currentStage.width, height: currentStage.height, background: stagesById.get(currentStage.id)?.background ?? null }
          : null,
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
      elements: EMPTY_EDITOR_ELEMENTS,
      replaceElements: noopReplaceElements,
      historyKey: null,
      emptyStateLabel: 'No editable source selected.',
      editable: false,
      createCapabilities: NOOP_CREATE_CAPABILITIES,
      meta: {},
    };
  }, [
    currentItemRef?.type,
    currentOverlay,
    currentSlide,
    currentStage,
    currentTheme,
    themeType,
    themesById,
    overlaysById,
    stagesById,
    getSlideElements,
    replaceSlideElements,
    replaceStageElements,
    replaceThemeElements,
    updateOverlayDraft,
    workbenchMode,
  ]);
}

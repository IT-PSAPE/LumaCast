import { useCallback, useMemo, type ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { DeckItemType } from '@lumacast/composition';
import { useElements, useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useCreateDeckItem } from '../../features/deck/create-deck-item';
import { useNavigation } from '../../contexts/navigation-context';
import { useDeckEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useSlides } from '../../contexts/slide-context';
import { useEditorLeftPanelNav } from '../../features/workbench/use-editor-left-panel-nav';
import { useSlideNotesPanel } from '../../features/deck/use-slide-notes-panel';
import { createScreenContext } from '../../contexts/create-screen-context';

interface DeckEditorScreenContextValue {
  state: {
    currentDeckItem: ReturnType<typeof useNavigation>['currentDeckItem'];
    currentDeckItemId: ReturnType<typeof useNavigation>['currentDeckItemId'];
    deckItems: ReturnType<typeof useProjectContent>['deckItems'];
    slides: ReturnType<typeof useSlides>['slides'];
    currentSlide: ReturnType<typeof useSlides>['currentSlide'];
    currentSlideIndex: ReturnType<typeof useSlides>['currentSlideIndex'];
    liveSlideIndex: ReturnType<typeof useSlides>['liveSlideIndex'];
    effectiveElements: ReturnType<typeof useElements>['effectiveElements'];
    hasPendingChanges: boolean;
    isPushingChanges: boolean;
    notesPanel: ReturnType<typeof useSlideNotesPanel>;
  };
  actions: {
    openCreateDeckItem: (kind: DeckItemType) => void;
    browseDeckItem: (id: Id) => void;
    setCurrentSlideIndex: (index: number) => void;
    createSlide: () => Promise<void>;
    duplicateSlide: ReturnType<typeof useSlides>['duplicateSlide'];
    deleteSlide: ReturnType<typeof useSlides>['deleteSlide'];
    moveSlide: ReturnType<typeof useSlides>['moveSlide'];
    saveChanges: () => Promise<void>;
    getSlideElements: ReturnType<typeof useDeckEditor>['getSlideElements'];
    getThumbnailScene: ReturnType<typeof useRenderScenes>['getThumbnailScene'];
  };
}

const [DeckEditorScreenContextProvider, useDeckEditorScreen] = createScreenContext<DeckEditorScreenContextValue>('DeckEditorScreenContext');

export function DeckEditorScreenProvider({ children }: { children: ReactNode }) {
  const { currentDeckItem, currentDeckItemId, browseDeckItem } = useNavigation();
  const { open: openCreateDeckItem } = useCreateDeckItem();
  const { effectiveElements } = useElements();
  const { getSlideElements, hasPendingChanges, isPushingChanges, pushChanges } = useDeckEditor();
  const {
    slides,
    currentSlide,
    currentSlideIndex,
    liveSlideIndex,
    setCurrentSlideIndex,
    createSlide,
    duplicateSlide,
    deleteSlide,
    moveSlide,
  } = useSlides();
  const { getThumbnailScene, commitProgramScene } = useRenderScenes();
  const notesPanel = useSlideNotesPanel();
  const { deckItems } = useProjectContent();

  useEditorLeftPanelNav({
    items: slides,
    currentId: currentSlide?.id ?? null,
    activate: (_id, index) => setCurrentSlideIndex(index),
  });

  const handleSaveChanges = useCallback(async () => {
    if (!hasPendingChanges) return;
    await pushChanges();
    commitProgramScene();
  }, [commitProgramScene, hasPendingChanges, pushChanges]);

  const value = useMemo<DeckEditorScreenContextValue>(() => ({
    state: {
      currentDeckItem,
      currentDeckItemId,
      deckItems,
      slides,
      currentSlide,
      currentSlideIndex,
      liveSlideIndex,
      effectiveElements,
      hasPendingChanges,
      isPushingChanges,
      notesPanel,
    },
    actions: {
      openCreateDeckItem,
      browseDeckItem,
      setCurrentSlideIndex,
      createSlide,
      duplicateSlide,
      deleteSlide,
      moveSlide,
      saveChanges: handleSaveChanges,
      getSlideElements,
      getThumbnailScene,
    },
  }), [
    browseDeckItem,
    createSlide,
    currentDeckItem,
    currentDeckItemId,
    currentSlide,
    currentSlideIndex,
    deckItems,
    deleteSlide,
    duplicateSlide,
    effectiveElements,
    getSlideElements,
    getThumbnailScene,
    handleSaveChanges,
    hasPendingChanges,
    isPushingChanges,
    liveSlideIndex,
    moveSlide,
    notesPanel,
    openCreateDeckItem,
    setCurrentSlideIndex,
    slides,
  ]);

  return <DeckEditorScreenContextProvider value={value}>{children}</DeckEditorScreenContextProvider>;
}

export { useDeckEditorScreen };

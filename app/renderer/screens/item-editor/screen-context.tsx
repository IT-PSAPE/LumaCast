import { useCallback, useMemo, type ReactNode } from 'react';
import type { ItemRef, ItemType } from '@lumacast/composition';
import { useElements, useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useCreateItem } from '../../features/items/create-item';
import { useNavigation } from '../../contexts/navigation-context';
import { useDeckEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useSlides } from '../../contexts/slide-context';
import { useEditorLeftPanelNav } from '../../features/workbench/use-editor-left-panel-nav';
import { useSlideNotesPanel } from '../../features/items/use-slide-notes-panel';
import { createScreenContext } from '../../contexts/create-screen-context';

// #219 item-model refactor decision D9: there is no merged deckItems array
// on useProjectContent any more (per-type arrays only), so this screen
// builds its own small view-model list — one entry per presentation/lyric/
// talk with its ItemRef attached — purely to drive the item picker below.
// This mirrors the precedent already set by use-app-menu.ts's exportWorkspace
// local concat: a screen-local UI view, not a stored merged-array concept.
interface ItemPickerEntry {
  itemRef: ItemRef;
  title: string;
}

interface ItemEditorScreenContextValue {
  state: {
    currentItem: ReturnType<typeof useNavigation>['currentItem'];
    currentItemRef: ReturnType<typeof useNavigation>['currentItemRef'];
    pickerItems: ItemPickerEntry[];
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
    openCreateItem: (type: ItemType) => void;
    browseItem: (itemRef: ItemRef) => void;
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

const [ItemEditorScreenContextProvider, useItemEditorScreen] = createScreenContext<ItemEditorScreenContextValue>('ItemEditorScreenContext');

export function ItemEditorScreenProvider({ children }: { children: ReactNode }) {
  const { currentItem, currentItemRef, browseItem } = useNavigation();
  const { open: openCreateItem } = useCreateItem();
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
  const { presentations, lyrics, talks } = useProjectContent();

  const pickerItems = useMemo<ItemPickerEntry[]>(() => [
    ...presentations.map((item) => ({ itemRef: { type: 'presentation' as const, id: item.id }, title: item.title })),
    ...lyrics.map((item) => ({ itemRef: { type: 'lyric' as const, id: item.id }, title: item.title })),
    ...talks.map((item) => ({ itemRef: { type: 'talk' as const, id: item.id }, title: item.title })),
  ], [presentations, lyrics, talks]);

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

  const value = useMemo<ItemEditorScreenContextValue>(() => ({
    state: {
      currentItem,
      currentItemRef,
      pickerItems,
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
      openCreateItem,
      browseItem,
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
    browseItem,
    createSlide,
    currentItem,
    currentItemRef,
    currentSlide,
    currentSlideIndex,
    pickerItems,
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
    openCreateItem,
    setCurrentSlideIndex,
    slides,
  ]);

  return <ItemEditorScreenContextProvider value={value}>{children}</ItemEditorScreenContextProvider>;
}

export { useItemEditorScreen };

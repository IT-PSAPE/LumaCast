import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { ItemType, ThemeOwnerType } from '@lumacast/composition';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useEditorLeftPanelNav } from '../../features/workbench/use-editor-left-panel-nav';
import { createScreenContext } from '../../contexts/create-screen-context';

interface ThemeEditorScreenContextValue {
  state: {
    themeType: ThemeOwnerType;
    themes: ReturnType<typeof useThemeEditor>['themes'];
    themesByType: ReturnType<typeof useThemeEditor>['themesByType'];
    currentThemeId: ReturnType<typeof useThemeEditor>['currentThemeId'];
    currentTheme: ReturnType<typeof useThemeEditor>['currentTheme'];
    hasPendingChanges: boolean;
    isPushingChanges: boolean;
    linkedItemCount: number;
    isSyncing: boolean;
  };
  actions: {
    setThemeType: (themeType: ThemeOwnerType) => void;
    selectTheme: (themeType: ThemeOwnerType, id: string) => void;
    requestThemeNameFocus: (id: string) => void;
    createTheme: (themeType: ThemeOwnerType) => void;
    saveChanges: () => Promise<void>;
    syncLinkedItems: () => Promise<void>;
  };
}

const [ThemeEditorScreenContextProvider, useThemeEditorScreen] = createScreenContext<ThemeEditorScreenContextValue>('ThemeEditorScreenContext');

export function ThemeEditorScreenProvider({ children }: { children: ReactNode }) {
  const {
    themeType,
    setThemeType,
    themes,
    themesByType,
    currentThemeId,
    currentTheme,
    hasPendingChanges,
    isPushingChanges,
    openThemeEditor,
    requestNameFocus,
    syncLinkedItems,
    createTheme,
    pushChanges,
  } = useThemeEditor();
  const { commitProgramScene } = useRenderScenes();
  const { presentations, lyrics, talks } = useProjectContent();
  const [isSyncing, setIsSyncing] = useState(false);

  // #219 item-model refactor decision D2: theme sync is strictly per-family
  // now, and overlays don't carry a persisted themeId at all (theming an
  // overlay is a one-shot apply, not a linked reference) — so the overlay
  // family simply has no "linked items" concept to count or sync.
  const itemsForFamily = themeType === 'presentation' ? presentations : themeType === 'lyric' ? lyrics : themeType === 'talk' ? talks : null;

  const linkedItemCount = currentTheme && itemsForFamily
    ? itemsForFamily.filter((item) => item.themeId === currentTheme.id).length
    : 0;

  useEditorLeftPanelNav({
    items: themes,
    currentId: currentThemeId,
    activate: (id) => openThemeEditor(themeType, id),
  });

  async function handleSyncLinkedItems() {
    if (!currentTheme || linkedItemCount === 0 || themeType === 'overlay') return;
    setIsSyncing(true);
    try {
      await syncLinkedItems(currentTheme.id, themeType as ItemType);
    } finally {
      setIsSyncing(false);
    }
  }

  const handleSaveChanges = useCallback(async () => {
    if (!hasPendingChanges) return;
    await pushChanges();
    commitProgramScene();
  }, [commitProgramScene, hasPendingChanges, pushChanges]);

  const value = useMemo<ThemeEditorScreenContextValue>(() => ({
    state: {
      themeType,
      themes,
      themesByType,
      currentThemeId,
      currentTheme,
      hasPendingChanges,
      isPushingChanges,
      linkedItemCount,
      isSyncing,
    },
    actions: {
      setThemeType,
      selectTheme: (nextThemeType, id) => openThemeEditor(nextThemeType, id),
      requestThemeNameFocus: requestNameFocus,
      createTheme: (nextThemeType) => createTheme(nextThemeType),
      saveChanges: handleSaveChanges,
      syncLinkedItems: handleSyncLinkedItems,
    },
  }), [
    createTheme,
    currentTheme,
    currentThemeId,
    handleSaveChanges,
    hasPendingChanges,
    isPushingChanges,
    isSyncing,
    linkedItemCount,
    openThemeEditor,
    requestNameFocus,
    setThemeType,
    themeType,
    themes,
    themesByType,
  ]);

  return <ThemeEditorScreenContextProvider value={value}>{children}</ThemeEditorScreenContextProvider>;
}

export { useThemeEditorScreen };

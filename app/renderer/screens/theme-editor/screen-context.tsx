import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { isThemeCompatibleWithDeckItem } from '@core/themes';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useEditorLeftPanelNav } from '../../features/workbench/use-editor-left-panel-nav';
import { createScreenContext } from '../../contexts/create-screen-context';

interface ThemeEditorScreenContextValue {
  state: {
    themes: ReturnType<typeof useThemeEditor>['themes'];
    currentThemeId: ReturnType<typeof useThemeEditor>['currentThemeId'];
    currentTheme: ReturnType<typeof useThemeEditor>['currentTheme'];
    hasPendingChanges: boolean;
    isPushingChanges: boolean;
    linkedItemCount: number;
    isSyncing: boolean;
  };
  actions: {
    selectTheme: (id: string) => void;
    requestThemeNameFocus: (id: string) => void;
    createTheme: ReturnType<typeof useThemeEditor>['createTheme'];
    saveChanges: () => Promise<void>;
    syncLinkedItems: () => Promise<void>;
  };
}

const [ThemeEditorScreenContextProvider, useThemeEditorScreen] = createScreenContext<ThemeEditorScreenContextValue>('ThemeEditorScreenContext');

export function ThemeEditorScreenProvider({ children }: { children: ReactNode }) {
  const {
    themes,
    currentThemeId,
    currentTheme,
    hasPendingChanges,
    isPushingChanges,
    openThemeEditor,
    requestNameFocus,
    syncLinkedDeckItems,
    createTheme,
    pushChanges,
  } = useThemeEditor();
  const { commitProgramScene } = useRenderScenes();
  const { deckItems } = useProjectContent();
  const [isSyncing, setIsSyncing] = useState(false);

  const linkedItemCount = currentTheme
    ? deckItems.filter((item) => item.themeId === currentTheme.id && isThemeCompatibleWithDeckItem(currentTheme, item.type)).length
    : 0;

  useEditorLeftPanelNav({
    items: themes,
    currentId: currentThemeId,
    activate: (id) => openThemeEditor(id),
  });

  async function handleSyncLinkedItems() {
    if (!currentTheme || linkedItemCount === 0) return;
    setIsSyncing(true);
    try {
      await syncLinkedDeckItems(currentTheme.id);
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
      themes,
      currentThemeId,
      currentTheme,
      hasPendingChanges,
      isPushingChanges,
      linkedItemCount,
      isSyncing,
    },
    actions: {
      selectTheme: openThemeEditor,
      requestThemeNameFocus: requestNameFocus,
      createTheme,
      saveChanges: handleSaveChanges,
      syncLinkedItems: handleSyncLinkedItems,
    },
  }), [
    createTheme,
    currentTheme,
    currentThemeId,
    hasPendingChanges,
    handleSaveChanges,
    isPushingChanges,
    isSyncing,
    linkedItemCount,
    openThemeEditor,
    requestNameFocus,
    themes,
  ]);

  return <ThemeEditorScreenContextProvider value={value}>{children}</ThemeEditorScreenContextProvider>;
}

export { useThemeEditorScreen };

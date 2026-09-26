import { useCallback, useMemo, type ReactNode } from 'react';
import type { ThemeOwnerType } from '@lumacast/composition';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
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
  };
  actions: {
    setThemeType: (themeType: ThemeOwnerType) => void;
    selectTheme: (themeType: ThemeOwnerType, id: string) => void;
    requestThemeNameFocus: (id: string) => void;
    createTheme: (themeType: ThemeOwnerType) => void;
    saveChanges: () => Promise<void>;
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
    createTheme,
    pushChanges,
  } = useThemeEditor();
  const { commitProgramScene } = useRenderScenes();

  // Live inherited themes: linked slides resolve the current theme at read
  // time, so there is no manual sync step — pushing the theme (Save or
  // leaving the editor) propagates to every linked slide, including staged
  // drafts via the theme draft projection.

  useEditorLeftPanelNav({
    items: themes,
    currentId: currentThemeId,
    activate: (id) => openThemeEditor(themeType, id),
  });

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
    },
    actions: {
      setThemeType,
      selectTheme: (nextThemeType, id) => openThemeEditor(nextThemeType, id),
      requestThemeNameFocus: requestNameFocus,
      createTheme: (nextThemeType) => createTheme(nextThemeType),
      saveChanges: handleSaveChanges,
    },
  }), [
    createTheme,
    currentTheme,
    currentThemeId,
    handleSaveChanges,
    hasPendingChanges,
    isPushingChanges,
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

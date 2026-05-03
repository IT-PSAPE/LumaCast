import { test, expect, type Page } from '@playwright/test';
import { createDefaultNdiOutputConfigs } from '../core/ndi';
import type { AppSnapshot, NdiDiagnostics, NdiOutputConfigMap, NdiOutputState } from '../core/types';

interface CastApiMockPayload {
  snapshot: AppSnapshot;
  ndiDiagnostics: NdiDiagnostics;
  ndiOutputConfigs: NdiOutputConfigMap;
  ndiOutputState: NdiOutputState;
}

function buildEmptySnapshot(): AppSnapshot {
  return {
    libraries: [],
    libraryBundles: [],
    presentations: [],
    lyrics: [],
    slides: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    themes: [],
    stages: [],
    collections: [],
  };
}

function buildNdiDiagnostics(outputState: NdiOutputState, outputConfigs: NdiOutputConfigMap): NdiDiagnostics {
  return {
    outputState,
    outputConfig: outputConfigs.audience,
    outputConfigs,
    runtimeLoaded: false,
    runtimePath: null,
    activeSender: null,
    senders: { audience: null, stage: null },
    sourceStatus: 'idle',
    lastError: null,
  };
}

async function installCastApiMock(page: Page): Promise<void> {
  const ndiOutputConfigs = createDefaultNdiOutputConfigs();
  const ndiOutputState = { audience: false, stage: false };
  const payload: CastApiMockPayload = {
    snapshot: buildEmptySnapshot(),
    ndiDiagnostics: buildNdiDiagnostics(ndiOutputState, ndiOutputConfigs),
    ndiOutputConfigs,
    ndiOutputState,
  };

  await page.addInitScript((mockPayload: CastApiMockPayload) => {
    const emptyPatch = { version: 1, upserts: {}, deletes: {} };
    const unsubscribe = () => {};
    let clipboardText = '';

    window.castApi = {
      platform: 'darwin',
      getPathForFile: () => '',
      readClipboardText: async () => clipboardText,
      writeClipboardText: async (text: string) => { clipboardText = text; },
      getInlineWindowMenuItems: async () => [],
      popupInlineWindowMenu: async () => {},
      updateAppMenuState: async () => {},
      checkForAppUpdates: async () => {},
      onAppMenuCommand: () => unsubscribe,
      getSnapshot: async () => mockPayload.snapshot,
      chooseDeckBundleExportPath: async () => null,
      chooseDeckBundleImportPath: async () => null,
      chooseImportReplacementMediaPath: async () => null,
      exportDeckBundle: async () => ({ filePath: '', itemCount: 0 }),
      inspectImportBundle: async () => ({
        exportedAt: '',
        itemCount: 0,
        themeCount: 0,
        mediaReferenceCount: 0,
        overlayCount: 0,
        stageCount: 0,
        items: [],
        themes: [],
        overlays: [],
        stages: [],
        mediaReferences: [],
        brokenReferences: [],
      }),
      finalizeImportBundle: async () => mockPayload.snapshot,
      createLibrary: async () => emptyPatch,
      createPlaylist: async () => emptyPatch,
      createPlaylistSegment: async () => emptyPatch,
      renamePlaylistSegment: async () => emptyPatch,
      setPlaylistSegmentColor: async () => emptyPatch,
      movePlaylist: async () => emptyPatch,
      addDeckItemToSegment: async () => emptyPatch,
      moveDeckItemToSegment: async () => emptyPatch,
      movePlaylistEntryToSegment: async () => emptyPatch,
      movePlaylistEntry: async () => mockPayload.snapshot,
      moveDeckItem: async () => emptyPatch,
      createPresentation: async () => emptyPatch,
      createLyric: async () => emptyPatch,
      createSlide: async () => emptyPatch,
      duplicateSlide: async () => emptyPatch,
      deleteSlide: async () => emptyPatch,
      updateSlideNotes: async () => emptyPatch,
      setSlideOrder: async () => emptyPatch,
      setLibraryOrder: async () => emptyPatch,
      setPlaylistOrder: async () => emptyPatch,
      setPlaylistSegmentOrder: async () => emptyPatch,
      movePlaylistEntryTo: async () => emptyPatch,
      createElement: async () => emptyPatch,
      createElementsBatch: async () => emptyPatch,
      updateElement: async () => emptyPatch,
      updateElementsBatch: async () => emptyPatch,
      deleteElement: async () => emptyPatch,
      deleteElementsBatch: async () => emptyPatch,
      createMediaAsset: async () => emptyPatch,
      deleteMediaAsset: async () => emptyPatch,
      updateMediaAssetSrc: async () => emptyPatch,
      getAudioCoverArt: async () => null,
      createOverlay: async () => emptyPatch,
      updateOverlay: async () => emptyPatch,
      setOverlayEnabled: async () => emptyPatch,
      deleteOverlay: async () => emptyPatch,
      createTheme: async () => emptyPatch,
      updateTheme: async () => emptyPatch,
      deleteTheme: async () => emptyPatch,
      applyThemeToDeckItem: async () => emptyPatch,
      detachThemeFromDeckItem: async () => emptyPatch,
      syncThemeToLinkedDeckItems: async () => emptyPatch,
      applyThemeToOverlay: async () => emptyPatch,
      renameLibrary: async () => emptyPatch,
      renamePlaylist: async () => emptyPatch,
      renamePresentation: async () => emptyPatch,
      renameLyric: async () => emptyPatch,
      deleteLibrary: async () => emptyPatch,
      deletePlaylist: async () => emptyPatch,
      deletePlaylistSegment: async () => emptyPatch,
      deletePresentation: async () => emptyPatch,
      deleteLyric: async () => emptyPatch,
      setNdiOutputEnabled: async () => mockPayload.ndiOutputState,
      getNdiOutputState: async () => mockPayload.ndiOutputState,
      getNdiOutputConfigs: async () => mockPayload.ndiOutputConfigs,
      updateNdiOutputConfig: async () => mockPayload.ndiOutputConfigs,
      getNdiDiagnostics: async () => mockPayload.ndiDiagnostics,
      sendNdiFrame: () => {},
      onNdiOutputStateChanged: () => unsubscribe,
      onNdiDiagnosticsChanged: () => unsubscribe,
    } as unknown as typeof window.castApi;
  }, payload);
}

test('workbench renders current toolbar labels and panel toggles', async ({ page }) => {
  await installCastApiMock(page);
  await page.goto('/');
  const toolbar = page.locator('[data-ui-region="app-toolbar"]');

  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Show' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Overlay' })).toBeVisible();

  await expect(toolbar.getByRole('button', { name: 'Left' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Bottom' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Right' })).toBeVisible();

  await toolbar.getByRole('button', { name: 'Overlay' }).click();

  await expect(toolbar.getByRole('button', { name: 'Left' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Right' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Bottom' })).toHaveCount(0);
});

test('editor add menus only expose actions for their own editor type', async ({ page }) => {
  await installCastApiMock(page);
  await page.goto('/');
  const applicationViews = page.getByLabel('Application views');

  await applicationViews.getByRole('button', { name: 'Overlay' }).click();
  await page.getByLabel('Add').click();
  await expect(page.getByRole('menuitem', { name: 'New overlay' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^New lyric$/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^New presentation$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await applicationViews.getByRole('button', { name: 'Themes' }).click();
  await page.getByLabel('Add').click();
  await expect(page.getByRole('menuitem', { name: 'New presentation theme' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New lyric theme' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^New lyric$/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^New presentation$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await applicationViews.getByRole('button', { name: 'Stage' }).click();
  await page.getByLabel('Add').click();
  await expect(page.getByRole('menuitem', { name: 'New stage' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New lyric' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'New presentation' })).toHaveCount(0);
});

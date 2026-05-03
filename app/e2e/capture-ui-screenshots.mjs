import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const OUTPUT_ROOT = path.resolve('docs/ui-spec-assets');
const SHARED_OUTPUT_DIR = path.join(OUTPUT_ROOT, 'shared');
const APP_OUTPUT_DIR = path.join(OUTPUT_ROOT, 'app');
const FEATURE_OUTPUT_DIR = path.join(OUTPUT_ROOT, 'features');
const TEMP_USER_DATA_DIR = path.resolve('out/playwright/user-data');
const ELECTRON_ENTRY = path.resolve('out/main/index.js');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resetCaptureEnvironment() {
  fs.rmSync(TEMP_USER_DATA_DIR, { recursive: true, force: true });
  ensureDir(TEMP_USER_DATA_DIR);
  ensureDir(OUTPUT_ROOT);
  ensureDir(SHARED_OUTPUT_DIR);
  ensureDir(APP_OUTPUT_DIR);
  ensureDir(FEATURE_OUTPUT_DIR);
}

async function waitForUiSpec(page) {
  await page.locator('[data-ui-spec="shared-actions"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(250);
}

async function waitForApp(page) {
  await page.locator('[data-ui-region="app-toolbar"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);
}

async function launchRenderer({ uiSpec, viewport }) {
  const app = await electron.launch({
    executablePath: process.env.ELECTRON_BINARY ?? (await import('electron')).default,
    args: [
      ELECTRON_ENTRY,
      `--user-data-dir=${TEMP_USER_DATA_DIR}`,
      ...(uiSpec ? ['--ui-spec'] : []),
    ],
  });

  const page = await app.firstWindow();
  await page.setViewportSize(viewport);
  if (uiSpec) {
    await waitForUiSpec(page);
  } else {
    await waitForApp(page);
  }

  return { app, page };
}

async function captureLocator(locator, filePath) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().screenshot({
    path: filePath,
    animations: 'disabled',
    caret: 'hide',
  });
}

async function clickToolbarView(page, label) {
  await page.locator('[data-ui-region="app-toolbar"]').getByRole('button', { name: label }).click();
  await page.waitForTimeout(350);
}

async function clickSlideBrowserMode(page, label) {
  await page.locator('[data-ui-region="slide-browser"]').getByRole('button', { name: label }).click();
  await page.waitForTimeout(350);
}

async function clickPlaylistBrowserMode(page, label) {
  await page.locator('[data-ui-region="slide-browser"]').getByRole('button', { name: label }).click();
  await page.waitForTimeout(350);
}

async function clickSettingsTab(page, label) {
  await page.locator('[data-ui-region="settings-dialog"]').getByRole('button', { name: label }).click();
  await page.waitForTimeout(350);
}

async function clickInspectorTab(page, label) {
  await page.locator('[data-ui-region="inspector-panel"]').getByRole('tab', { name: label }).click();
  await page.waitForTimeout(350);
}

async function clickPreviewTab(page, label) {
  await page.locator('[data-ui-region="preview-panel"]').getByRole('tab', { name: label }).click();
  await page.waitForTimeout(350);
}

async function clickResourceDrawerTab(page, label) {
  await page.locator('[data-ui-region="resource-drawer"]').getByRole('tab', { name: label }).click();
  await page.waitForTimeout(350);
}

async function ensureLibrarySelectorView(page) {
  const backButton = page.locator('[data-ui-region="library-panel"]').getByRole('button', { name: 'Back to libraries' });
  const hasBackButton = await backButton.isVisible().catch(() => false);
  if (hasBackButton) {
    await backButton.click();
    await page.waitForTimeout(350);
  }
}

async function ensurePlaylistView(page) {
  const backButton = page.locator('[data-ui-region="library-panel"]').getByRole('button', { name: 'Back to libraries' });
  const isPlaylistView = await backButton.isVisible().catch(() => false);
  if (isPlaylistView) return;

  await page.locator('[data-ui-region="library-panel"]').getByRole('listitem').first().click();
  await page.waitForTimeout(400);
}

async function selectPresentation(page, title) {
  await ensurePlaylistView(page);
  await page.locator('[data-ui-region="library-panel"]').getByRole('button', { name: title }).first().click();
  await page.waitForTimeout(500);
}

async function selectSlideInEditor(page, index) {
  await page.locator('[data-ui-region="slide-list-panel"] [role="grid"] > button').nth(index).click();
  await page.waitForTimeout(400);
}

async function assignMediaLayer(page) {
  await clickResourceDrawerTab(page, 'Media');
  await page.locator('[data-ui-region="resource-drawer"]').getByRole('button', { name: /Gradient Backdrop/i }).click();
  await page.waitForTimeout(350);
}

async function assignOverlayLayer(page) {
  await clickPreviewTab(page, 'Overlays');
  await page.locator('[data-ui-region="preview-panel"]').getByRole('button', { name: /Watermark/i }).click();
  await page.waitForTimeout(350);
}

async function seedScenario(page) {
  const gradientBackdrop = createSvgDataUrl('#0f172a', '#2563eb', 'Gradient Backdrop');

  await page.evaluate(async ({ gradientBackdropSrc }) => {
    async function getSnapshot() {
      return window.castApi.getSnapshot();
    }

    function sortByOrder(items) {
      return items.slice().sort((left, right) => left.order - right.order);
    }

    function createTextElement(text, x, y, width, height) {
      return {
        type: 'text',
        x,
        y,
        width,
        height,
        zIndex: 10,
        layer: 'content',
        payload: {
          text,
          fontFamily: 'Avenir Next',
          fontSize: 52,
          color: '#FFFFFF',
          alignment: 'center',
          verticalAlign: 'middle',
          lineHeight: 1.2,
          weight: '700',
        },
      };
    }

    function createShapeElement(fillColor, x, y, width, height) {
      return {
        type: 'shape',
        x,
        y,
        width,
        height,
        zIndex: 1,
        layer: 'background',
        payload: {
          fillColor,
          borderColor: '#FFFFFF33',
          borderWidth: 2,
          borderRadius: 18,
        },
      };
    }

    async function ensureBaseStructure() {
      let snapshot = await getSnapshot();
      let library = snapshot.libraries[0] ?? null;
      if (!library) {
        await window.castApi.createLibrary('Church Library');
        snapshot = await getSnapshot();
        library = snapshot.libraries[0] ?? null;
      }

      let bundle = snapshot.libraryBundles.find((entry) => entry.library.id === library.id) ?? snapshot.libraryBundles[0] ?? null;
      let playlist = bundle?.playlists[0]?.playlist ?? null;
      if (!playlist) {
        await window.castApi.createPlaylist(library.id, 'Sunday Service');
        snapshot = await getSnapshot();
        bundle = snapshot.libraryBundles.find((entry) => entry.library.id === library.id) ?? snapshot.libraryBundles[0] ?? null;
        playlist = bundle?.playlists[0]?.playlist ?? null;
      }

      let segment = bundle?.playlists[0]?.segments[0]?.segment ?? null;
      if (!segment) {
        await window.castApi.createPlaylistSegment(playlist.id, 'Opening');
        snapshot = await getSnapshot();
        bundle = snapshot.libraryBundles.find((entry) => entry.library.id === library.id) ?? snapshot.libraryBundles[0] ?? null;
        segment = bundle?.playlists[0]?.segments[0]?.segment ?? null;
      }

      return {
        libraryId: library.id,
        playlistId: playlist.id,
        segmentId: segment.id,
      };
    }

    async function ensureMediaAsset(name, src) {
      const snapshot = await getSnapshot();
      const existing = snapshot.mediaAssets.find((asset) => asset.name === name);
      if (existing) return existing.id;
      await window.castApi.createMediaAsset({ name, src, type: 'image' });
      const next = await getSnapshot();
      return next.mediaAssets.find((asset) => asset.name === name)?.id ?? null;
    }

    async function ensureTheme(name, kind, elements) {
      const snapshot = await getSnapshot();
      const existing = snapshot.themes.find((theme) => theme.name === name);
      if (existing) return existing.id;
      await window.castApi.createTheme({
        name,
        kind,
        width: 1920,
        height: 1080,
        elements,
      });
      const next = await getSnapshot();
      return next.themes.find((theme) => theme.name === name)?.id ?? null;
    }

    async function ensureDeck(ids, title, slideSpecs) {
      let snapshot = await getSnapshot();
      let deck = snapshot.presentations.find((item) => item.title === title) ?? null;

      if (!deck) {
        await window.castApi.createPresentation(title);
        snapshot = await getSnapshot();
        deck = snapshot.presentations.find((item) => item.title === title) ?? null;
      }

      let slides = sortByOrder(snapshot.slides.filter((slide) => slide.presentationId === deck.id));
      while (slides.length < slideSpecs.length) {
        await window.castApi.createSlide({ presentationId: deck.id });
        snapshot = await getSnapshot();
        slides = sortByOrder(snapshot.slides.filter((slide) => slide.presentationId === deck.id));
      }

      for (let index = 0; index < slideSpecs.length; index += 1) {
        const spec = slideSpecs[index];
        const slide = slides[index];
        if (!slide) continue;

        if (slide.notes !== spec.notes) {
          await window.castApi.updateSlideNotes({ slideId: slide.id, notes: spec.notes });
        }

        snapshot = await getSnapshot();
        const existingElements = snapshot.slideElements.filter((element) => element.slideId === slide.id);
        if (existingElements.length === 0 && spec.elements.length > 0) {
          await window.castApi.createElementsBatch(
            spec.elements.map((element) => ({
              slideId: slide.id,
              ...element,
            })),
          );
        }
      }

      snapshot = await getSnapshot();
      const bundle = snapshot.libraryBundles.find((entry) => entry.library.id === ids.libraryId) ?? null;
      const playlistTree = bundle?.playlists.find((tree) => tree.playlist.id === ids.playlistId) ?? null;
      const alreadyInSegment = playlistTree?.segments.some((entry) => entry.entries.some((item) => item.item.id === deck.id)) ?? false;
      if (!alreadyInSegment) {
        await window.castApi.addDeckItemToSegment(ids.segmentId, deck.id);
      }
    }

    const ids = await ensureBaseStructure();

    await ensureMediaAsset('Gradient Backdrop', gradientBackdropSrc);

    await ensureDeck(ids, 'Welcome Slides', [
      { notes: 'Live welcome slide for the opening state.', elements: [] },
      {
        notes: 'Editor-selected slide with notes and objects.',
        elements: [
          createShapeElement('#0F172ACC', 200, 320, 1520, 340),
          createTextElement('Service begins in 5 minutes', 280, 430, 1360, 140),
        ],
      },
      { notes: 'Intentional empty slide for warning-state coverage.', elements: [] },
    ]);

    await ensurePresentation(ids, 'Announcements', [
      {
        notes: 'Announcements presentation overview.',
        elements: [
          createShapeElement('#1E1B4BCC', 180, 300, 1560, 400),
          createTextElement('Community announcements', 260, 420, 1400, 120),
        ],
      },
      {
        notes: 'Second announcements slide.',
        elements: [
          createShapeElement('#0C4A6ECC', 220, 340, 1480, 320),
          createTextElement('Midweek prayer gathering', 280, 430, 1360, 110),
        ],
      },
    ]);

    await ensureTheme('Service Slide Theme', 'slides', [
      createShapeElement('#111827CC', 160, 280, 1600, 440),
      createTextElement('Theme Title', 240, 420, 1440, 140),
    ]);

    await ensureTheme('Lower Third Overlay Theme', 'overlays', [
      createShapeElement('#0F172ACC', 120, 820, 1680, 180),
      createTextElement('Overlay Title', 220, 850, 1280, 90),
    ]);
  }, { gradientBackdropSrc: gradientBackdrop });

  await page.reload();
  await waitForApp(page);
}

async function captureSharedScreenshots() {
  const { app, page } = await launchRenderer({
    uiSpec: true,
    viewport: { width: 1720, height: 2600 },
  });

  try {
    await captureLocator(page.locator('[data-ui-spec="shared-actions"]'), path.join(SHARED_OUTPUT_DIR, 'shared-actions.png'));
    await captureLocator(page.locator('[data-ui-spec="shared-fields"]'), path.join(SHARED_OUTPUT_DIR, 'shared-fields.png'));
    await captureLocator(page.locator('[data-ui-spec="shared-navigation"]'), path.join(SHARED_OUTPUT_DIR, 'shared-navigation.png'));
    await captureLocator(page.locator('[data-ui-spec="shared-display"]'), path.join(SHARED_OUTPUT_DIR, 'shared-display.png'));
    await captureLocator(page.locator('[data-ui-spec="shared-dialogs"]'), path.join(SHARED_OUTPUT_DIR, 'shared-dialogs.png'));
  } finally {
    await app.close();
  }
}

async function captureAppScreenshots() {
  const { app, page } = await launchRenderer({
    uiSpec: false,
    viewport: { width: 1720, height: 1180 },
  });

  try {
    await seedScenario(page);

    await ensureLibrarySelectorView(page);
    await captureLocator(page.locator('[data-ui-region="library-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'library-panel-libraries.png'));

    await selectPresentation(page, 'Welcome Slides');

    await clickToolbarView(page, 'Edit');
    await captureLocator(page.locator('[data-ui-region="app-toolbar"]'), path.join(APP_OUTPUT_DIR, 'app-toolbar-slide-editor.png'));

    await selectSlideInEditor(page, 1);
    await captureLocator(page.locator('[data-ui-region="slide-editor-layout"]'), path.join(APP_OUTPUT_DIR, 'slide-editor-layout.png'));
    await captureLocator(page.locator('[data-ui-region="slide-list-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-list-panel.png'));
    await captureLocator(page.locator('[data-ui-region="slide-notes-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-notes-panel.png'));
    await captureLocator(page.locator('[data-ui-region="stage-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'stage-panel-slide-editor.png'));
    await captureLocator(page.locator('[data-ui-region="object-list-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'object-list-panel.png'));
    await captureLocator(page.locator('[data-ui-region="inspector-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'inspector-presentation.png'));

    await page.locator('[data-ui-region="object-list-panel"] button', { hasText: 'Shape' }).first().click();
    await page.waitForTimeout(350);
    await captureLocator(page.locator('[data-ui-region="inspector-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'inspector-shape.png'));

    await page.locator('[data-ui-region="object-list-panel"] button', { hasText: 'Service begins in 5 minutes' }).first().click();
    await page.waitForTimeout(350);
    await clickInspectorTab(page, 'Text');
    await captureLocator(page.locator('[data-ui-region="inspector-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'inspector-text.png'));

    await clickToolbarView(page, 'Overlay');
    await captureLocator(page.locator('[data-ui-region="app-toolbar"]'), path.join(APP_OUTPUT_DIR, 'app-toolbar-overlay-editor.png'));
    await page.locator('[data-ui-region="overlay-list-panel"] [role="grid"] > button').first().click();
    await page.waitForTimeout(350);
    await captureLocator(page.locator('[data-ui-region="overlay-editor-layout"]'), path.join(APP_OUTPUT_DIR, 'overlay-editor-layout.png'));
    await captureLocator(page.locator('[data-ui-region="overlay-list-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'overlay-list-panel.png'));
    await captureLocator(page.locator('[data-ui-region="stage-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'stage-panel-overlay-editor.png'));
    await captureLocator(page.locator('[data-ui-region="inspector-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'inspector-overlay.png'));

    await clickToolbarView(page, 'Show');
    await captureLocator(page.locator('[data-ui-region="app-toolbar"]'), path.join(APP_OUTPUT_DIR, 'app-toolbar-show.png'));
    await captureLocator(page.locator('[data-ui-region="library-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'library-panel-playlist.png'));

    await assignMediaLayer(page);
    await captureLocator(page.locator('[data-ui-region="resource-drawer"]'), path.join(FEATURE_OUTPUT_DIR, 'resource-drawer-media.png'));

    await assignOverlayLayer(page);
    await captureLocator(page.locator('[data-ui-region="preview-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'preview-panel-overlays.png'));

    await clickResourceDrawerTab(page, 'Presentations');
    await captureLocator(page.locator('[data-ui-region="resource-drawer"]'), path.join(FEATURE_OUTPUT_DIR, 'resource-drawer-content.png'));

    await clickResourceDrawerTab(page, 'Themes');
    await captureLocator(page.locator('[data-ui-region="resource-drawer"]'), path.join(FEATURE_OUTPUT_DIR, 'resource-drawer-themes.png'));

    await clickResourceDrawerTab(page, 'Media');
    await clickSlideBrowserMode(page, 'Grid view');
    await clickPlaylistBrowserMode(page, 'Current');
    await captureLocator(page.locator('[data-ui-region="slide-browser"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-browser-grid-current.png'));
    await captureLocator(page.locator('[data-ui-region="show-mode-layout"]'), path.join(APP_OUTPUT_DIR, 'show-mode-layout.png'));
    await captureLocator(page.locator('[data-ui-region="preview-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'preview-panel.png'));
    await clickPreviewTab(page, 'Audio');
    await captureLocator(page.locator('[data-ui-region="preview-panel"]'), path.join(FEATURE_OUTPUT_DIR, 'preview-panel-audio.png'));
    await clickPreviewTab(page, 'Overlays');
    await captureLocator(page.locator('[data-ui-region="status-bar"]'), path.join(APP_OUTPUT_DIR, 'status-bar.png'));

    await clickSlideBrowserMode(page, 'List view');
    await captureLocator(page.locator('[data-ui-region="slide-browser"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-browser-list-current.png'));

    await clickSlideBrowserMode(page, 'Focus view');
    await captureLocator(page.locator('[data-ui-region="slide-browser"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-browser-focus.png'));

    await clickSlideBrowserMode(page, 'Grid view');
    await clickPlaylistBrowserMode(page, 'Tabs');
    await captureLocator(page.locator('[data-ui-region="slide-browser"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-browser-tabs.png'));

    await clickPlaylistBrowserMode(page, 'Continuous');
    await captureLocator(page.locator('[data-ui-region="slide-browser"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-browser-continuous-grid.png'));

    await clickSlideBrowserMode(page, 'List view');
    await captureLocator(page.locator('[data-ui-region="slide-browser"]'), path.join(FEATURE_OUTPUT_DIR, 'slide-browser-continuous-list.png'));

    await page.locator('[data-ui-region="app-toolbar"]').getByRole('button', { name: 'Settings' }).click();
    await page.waitForTimeout(350);
    await captureLocator(page.locator('[data-ui-region="settings-dialog"]'), path.join(APP_OUTPUT_DIR, 'settings-dialog.png'));
    await captureLocator(page.locator('[data-ui-region="settings-dialog"]'), path.join(APP_OUTPUT_DIR, 'settings-dialog-appearance.png'));
    await clickSettingsTab(page, 'Outputs');
    await captureLocator(page.locator('[data-ui-region="settings-dialog"]'), path.join(APP_OUTPUT_DIR, 'settings-dialog-outputs.png'));
    await clickSettingsTab(page, 'Overlays');
    await captureLocator(page.locator('[data-ui-region="settings-dialog"]'), path.join(APP_OUTPUT_DIR, 'settings-dialog-overlays.png'));
  } finally {
    await app.close();
  }
}

function createSvgDataUrl(background, accent, label) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${background}" />
          <stop offset="100%" stop-color="${accent}" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" rx="18" fill="url(#g)" />
      <circle cx="70" cy="72" r="46" fill="rgba(255,255,255,0.16)" />
      <rect x="122" y="58" width="124" height="20" rx="10" fill="rgba(255,255,255,0.24)" />
      <rect x="122" y="90" width="82" height="14" rx="7" fill="rgba(255,255,255,0.16)" />
      <text x="24" y="152" fill="white" font-size="18" font-family="Avenir Next, Helvetica, Arial" font-weight="700">${label}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function writeManifest() {
  const files = fs
    .readdirSync(OUTPUT_ROOT, { recursive: true })
    .filter((file) => typeof file === 'string' && file.endsWith('.png'))
    .map((file) => file.replaceAll('\\', '/'))
    .sort();

  const lines = [
    '# UI Screenshot Manifest',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Shared',
    ...files.filter((file) => file.startsWith('shared/')).map((file) => `- ${file}`),
    '',
    '## App',
    ...files.filter((file) => file.startsWith('app/')).map((file) => `- ${file}`),
    '',
    '## Features',
    ...files.filter((file) => file.startsWith('features/')).map((file) => `- ${file}`),
    '',
  ];

  fs.writeFileSync(path.join(OUTPUT_ROOT, 'manifest.md'), lines.join('\n'), 'utf8');
}

async function main() {
  resetCaptureEnvironment();
  await captureSharedScreenshots();
  await captureAppScreenshots();
  writeManifest();
}

main().catch((error) => {
  console.error('[capture-ui-screenshots] failed', error);
  process.exitCode = 1;
});

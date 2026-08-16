import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const APP_ENTRY = path.resolve('out/main/index.js');
const SMOKE_LIBRARY_NAME = 'Smoke Persistence Library';
const SMOKE_PRESENTATION_TITLE = 'Smoke Persistence Presentation';
const APP_TOOLBAR_REGION = '[data-ui-region="app-toolbar"]';
const STARTUP_TIMEOUT_MS = 30_000;

let userDataDir = '';

test.beforeAll(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-smoke-'));
});

test.afterAll(() => {
  if (userDataDir) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath =
    process.env.ELECTRON_BINARY ?? ((await import('electron')) as unknown as { default: string }).default;
  const app = await _electron.launch({
    executablePath,
    args: [APP_ENTRY, `--user-data-dir=${userDataDir}`],
  });
  const page = await app.firstWindow();
  await page.locator(APP_TOOLBAR_REGION).waitFor({ state: 'visible', timeout: STARTUP_TIMEOUT_MS });
  return { app, page };
}

test('app starts and persists a library, presentation, and slide across a relaunch on the same user-data directory', async () => {
  test.setTimeout(120_000);

  let createdLibraryId: string | null = null;
  let createdPresentationId: string | null = null;
  let createdSlideId: string | null = null;

  const first = await launchApp();
  try {
    const snapshot = await first.page.evaluate(() => window.castApi.getSnapshot());
    expect(snapshot.libraries.some((library) => library.name === SMOKE_LIBRARY_NAME)).toBe(false);

    await first.page.evaluate((name) => window.castApi.createLibrary(name), SMOKE_LIBRARY_NAME);
    await first.page.evaluate((title) => window.castApi.createPresentation(title), SMOKE_PRESENTATION_TITLE);

    const created = await first.page.evaluate(
      async ({ libraryName, presentationTitle }) => {
        const next = await window.castApi.getSnapshot();
        const library = next.libraries.find((item) => item.name === libraryName);
        const presentation = next.presentations.find((item) => item.title === presentationTitle);
        return { libraryId: library?.id ?? null, presentationId: presentation?.id ?? null };
      },
      { libraryName: SMOKE_LIBRARY_NAME, presentationTitle: SMOKE_PRESENTATION_TITLE },
    );

    expect(created.libraryId).not.toBeNull();
    expect(created.presentationId).not.toBeNull();
    createdLibraryId = created.libraryId;
    createdPresentationId = created.presentationId;

    const slideCreated = await first.page.evaluate(
      async ({ presentationId }) => {
        await window.castApi.createSlide({ presentationId });
        const next = await window.castApi.getSnapshot();
        const slide = next.slides.find((item) => item.presentationId === presentationId);
        return slide?.id ?? null;
      },
      { presentationId: createdPresentationId },
    );

    expect(slideCreated).not.toBeNull();
    createdSlideId = slideCreated;
  } finally {
    await first.app.close();
  }

  expect(createdLibraryId).not.toBeNull();
  expect(createdPresentationId).not.toBeNull();
  expect(createdSlideId).not.toBeNull();

  const second = await launchApp();
  try {
    const persisted = await second.page.evaluate(
      async ({ libraryName, presentationTitle, slideId }) => {
        const snapshot = await window.castApi.getSnapshot();
        const library = snapshot.libraries.find((item) => item.name === libraryName);
        const presentation = snapshot.presentations.find((item) => item.title === presentationTitle);
        const slide = snapshot.slides.find((item) => item.id === slideId);
        return { libraryId: library?.id ?? null, presentationId: presentation?.id ?? null, slideId: slide?.id ?? null };
      },
      { libraryName: SMOKE_LIBRARY_NAME, presentationTitle: SMOKE_PRESENTATION_TITLE, slideId: createdSlideId },
    );

    expect(persisted.libraryId).toBe(createdLibraryId);
    expect(persisted.presentationId).toBe(createdPresentationId);
    expect(persisted.slideId).toBe(createdSlideId);
  } finally {
    await second.app.close();
  }
});
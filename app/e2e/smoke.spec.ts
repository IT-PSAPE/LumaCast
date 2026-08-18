import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const APP_ENTRY = path.resolve('out/main/index.js');
const SMOKE_PLAYLIST_NAME = 'Smoke Persistence Playlist';
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

test('app starts and persists a playlist, item, and slide across a relaunch on the same user-data directory', async () => {
  test.setTimeout(120_000);

  let createdPlaylistId: string | null = null;
  let createdItemId: string | null = null;
  let createdSlideId: string | null = null;

  const first = await launchApp();
  try {
    const snapshot = await first.page.evaluate(() => window.castApi.getSnapshot());
    expect(snapshot.playlists.some((playlist) => playlist.name === SMOKE_PLAYLIST_NAME)).toBe(false);

    const created = await first.page.evaluate(
      async ({ playlistName, presentationTitle }) => {
        await window.castApi.createPlaylist(playlistName);
        const afterPlaylist = await window.castApi.getSnapshot();
        const playlist = afterPlaylist.playlists.find((item) => item.name === playlistName);
        if (!playlist) return { playlistId: null, itemId: null, slideId: null };

        const { itemId } = await window.castApi.createItem({
          type: 'presentation',
          title: presentationTitle,
          playlistId: playlist.id,
        });
        const next = await window.castApi.getSnapshot();
        const slide = next.slides.find((item) => item.presentationId === itemId);
        return { playlistId: playlist.id, itemId, slideId: slide?.id ?? null };
      },
      { playlistName: SMOKE_PLAYLIST_NAME, presentationTitle: SMOKE_PRESENTATION_TITLE },
    );

    expect(created.playlistId).not.toBeNull();
    expect(created.itemId).not.toBeNull();
    expect(created.slideId).not.toBeNull();
    createdPlaylistId = created.playlistId;
    createdItemId = created.itemId;
    createdSlideId = created.slideId;
  } finally {
    await first.app.close();
  }

  expect(createdPlaylistId).not.toBeNull();
  expect(createdItemId).not.toBeNull();
  expect(createdSlideId).not.toBeNull();

  const second = await launchApp();
  try {
    const persisted = await second.page.evaluate(
      async ({ playlistName, presentationTitle, slideId }) => {
        const snapshot = await window.castApi.getSnapshot();
        const playlist = snapshot.playlists.find((item) => item.name === playlistName);
        const presentation = snapshot.presentations.find((item) => item.title === presentationTitle);
        const slide = snapshot.slides.find((item) => item.id === slideId);
        const entry = playlist
          ? snapshot.playlistEntries.find(
              (row) => row.kind === 'item' && row.playlistId === playlist.id && row.presentationId === presentation?.id,
            )
          : undefined;
        return {
          playlistId: playlist?.id ?? null,
          itemId: presentation?.id ?? null,
          slideId: slide?.id ?? null,
          entryPlaylistId: entry?.playlistId ?? null,
        };
      },
      { playlistName: SMOKE_PLAYLIST_NAME, presentationTitle: SMOKE_PRESENTATION_TITLE, slideId: createdSlideId },
    );

    expect(persisted.playlistId).toBe(createdPlaylistId);
    expect(persisted.itemId).toBe(createdItemId);
    expect(persisted.slideId).toBe(createdSlideId);
    expect(persisted.entryPlaylistId).toBe(createdPlaylistId);
  } finally {
    await second.app.close();
  }
});
// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaAssetStore, MEDIA_SCHEME_PRIVILEGES } from '../../../../apps/stream/main/media-assets';

const showOpenDialog = vi.fn();

const temporaryDirectories: string[] = [];

afterEach(async () => {
  showOpenDialog.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lumastream-media-assets-'));
  temporaryDirectories.push(root);
  const dataDirectory = path.join(root, 'data');
  const mediaDirectory = path.join(dataDirectory, 'media');
  const window = { isDestroyed: () => false } as BrowserWindow;
  const store = new MediaAssetStore(dataDirectory, () => window, { showOpenDialog });
  const sourceFile = async (name: string, contents = name) => {
    const filePath = path.join(root, name);
    await writeFile(filePath, contents);
    return filePath;
  };
  return { store, dataDirectory, mediaDirectory, window, sourceFile };
}

describe('Stream managed media import', () => {
  it('imports every selected image in chooser order with distinct managed IDs', async () => {
    const { store, mediaDirectory, window, sourceFile } = await createStore();
    const filePaths = await Promise.all([
      sourceFile('02.png', 'second image'),
      sourceFile('01.JPG', 'first image'),
      sourceFile('03.webp', 'third image'),
    ]);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths });

    const assets = await store.chooseAndImportImages(3);

    expect(showOpenDialog).toHaveBeenCalledWith(window, expect.objectContaining({
      title: 'Add slideshow images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
    }));
    expect(assets.map(({ name, extension, kind }) => ({ name, extension, kind }))).toEqual([
      { name: '02', extension: 'png', kind: 'image' },
      { name: '01', extension: 'jpg', kind: 'image' },
      { name: '03', extension: 'webp', kind: 'image' },
    ]);
    expect(new Set(assets.map(({ id }) => id)).size).toBe(3);
    await expect(Promise.all(assets.map(({ id, extension }) => readFile(path.join(mediaDirectory, `${id}.${extension}`), 'utf8')))).resolves.toEqual([
      'second image', 'first image', 'third image',
    ]);
  });

  it.each([
    { canceled: true, filePaths: ['ignored.png'] },
    { canceled: false, filePaths: [] },
  ])('returns no images without creating media when the picker is canceled or empty (%#)', async (result) => {
    const { store, mediaDirectory } = await createStore();
    showOpenDialog.mockResolvedValue(result);
    await expect(store.chooseAndImportImages(100)).resolves.toEqual([]);
    await expect(readdir(mediaDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([0, -1, 101, 1.5, NaN, Infinity])('rejects an invalid remaining image limit (%s) before opening the picker', async (maxImages) => {
    const { store } = await createStore();
    await expect(store.chooseAndImportImages(maxImages)).rejects.toThrow('slideshow image limit is invalid');
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it('rejects a selection above the remaining limit before copying any files', async () => {
    const { store, mediaDirectory, sourceFile } = await createStore();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: await Promise.all([sourceFile('one.png'), sourceFile('two.png')]) });
    await expect(store.chooseAndImportImages(1)).rejects.toThrow('Choose no more than 1 slideshow image.');
    await expect(readdir(mediaDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { name: 'empty.png', contents: '', error: /empty or invalid/ },
    { name: 'unsupported.txt', contents: 'not an image', error: /file type is not supported/ },
  ])('rolls back the complete selection when $name fails validation, preserving existing files', async ({ name, contents, error }) => {
    const { store, mediaDirectory, sourceFile } = await createStore();
    await mkdir(mediaDirectory, { recursive: true });
    await writeFile(path.join(mediaDirectory, 'existing.png'), 'existing image');
    const firstPath = await sourceFile('first.png', 'valid image');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [firstPath, await sourceFile(name, contents)] });

    await expect(store.chooseAndImportImages(100)).rejects.toThrow(error);

    await expect(readdir(mediaDirectory)).resolves.toEqual(['existing.png']);
    await expect(readFile(path.join(mediaDirectory, 'existing.png'), 'utf8')).resolves.toBe('existing image');
    await expect(readFile(firstPath, 'utf8')).resolves.toBe('valid image');
  });

  it('rolls back previously imported images when a later file cannot be copied', async () => {
    const { store, mediaDirectory, dataDirectory, sourceFile } = await createStore();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [await sourceFile('first.png'), path.join(dataDirectory, 'missing.png')] });
    await expect(store.chooseAndImportImages(100)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(mediaDirectory)).resolves.toEqual([]);
  });

  it('rolls back previously imported images when a later path is malformed', async () => {
    const { store, mediaDirectory, sourceFile } = await createStore();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [await sourceFile('first.png'), 'invalid\u0000.png'] });
    await expect(store.chooseAndImportImages(100)).rejects.toThrow(/null bytes/);
    await expect(readdir(mediaDirectory)).resolves.toEqual([]);
  });

  it('rejects an unavailable window before opening the picker', async () => {
    const { dataDirectory } = await createStore();
    const store = new MediaAssetStore(dataDirectory, () => null);
    await expect(store.chooseAndImportImages(100)).rejects.toThrow('Stream window is not available');
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it('keeps the single-media picker and return contract unchanged', async () => {
    const { store, mediaDirectory, window, sourceFile } = await createStore();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [await sourceFile('single.mp4', 'video bytes'), await sourceFile('ignored.mp4')] });

    const asset = await store.chooseAndImport('video');

    expect(showOpenDialog).toHaveBeenCalledWith(window, expect.objectContaining({
      title: 'Add video', properties: ['openFile'],
    }));
    expect(asset).toMatchObject({ name: 'single', kind: 'video', extension: 'mp4' });
    await expect(readFile(path.join(mediaDirectory, `${asset!.id}.mp4`), 'utf8')).resolves.toBe('video bytes');
    await expect(readdir(mediaDirectory)).resolves.toHaveLength(1);

    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(store.chooseAndImport('image')).resolves.toBeNull();
  });
});

describe('Stream managed media protocol', () => {
  const assetId = '123e4567-e89b-12d3-a456-426614174000';
  const assetUrl = `lumastream://media/${assetId}.png`;

  async function createProtocolFixture(contents = '0123456789') {
    const fixture = await createStore();
    await mkdir(fixture.mediaDirectory, { recursive: true });
    await writeFile(path.join(fixture.mediaDirectory, `${assetId}.png`), contents);
    return fixture;
  }

  function request(store: MediaAssetStore, method: string, url = assetUrl, range?: string) {
    const headers = new Headers();
    if (range) headers.set('range', range);
    return store.handler()({ method, url, headers });
  }

  it('opts the managed media scheme into CORS without bypassing CSP', () => {
    expect(MEDIA_SCHEME_PRIVILEGES).toMatchObject({ corsEnabled: true, bypassCSP: false });
  });

  it('serves full assets with CORS headers for cross-origin canvas drawing', async () => {
    const { store } = await createProtocolFixture();

    const response = await request(store, 'GET');

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('10');
    await expect(response.text()).resolves.toBe('0123456789');
  });

  it('serves byte-range responses with CORS headers and the requested bytes', async () => {
    const { store } = await createProtocolFixture();

    const response = await request(store, 'GET', assetUrl, 'bytes=2-5');

    expect(response.status).toBe(206);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(response.headers.get('content-length')).toBe('4');
    await expect(response.text()).resolves.toBe('2345');
  });

  it('preserves HEAD metadata for full and ranged requests, including CORS headers', async () => {
    const { store } = await createProtocolFixture();

    const fullResponse = await request(store, 'HEAD');
    expect(fullResponse.status).toBe(200);
    expect(fullResponse.headers.get('access-control-allow-origin')).toBe('*');
    expect(fullResponse.headers.get('content-length')).toBe('10');
    await expect(fullResponse.text()).resolves.toBe('');

    const rangeResponse = await request(store, 'HEAD', assetUrl, 'bytes=2-5');
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get('access-control-allow-origin')).toBe('*');
    expect(rangeResponse.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(rangeResponse.headers.get('content-length')).toBe('4');
    await expect(rangeResponse.text()).resolves.toBe('');
  });

  it('retains method, URL, range, and missing-file rejection behavior', async () => {
    const { store } = await createProtocolFixture();

    expect((await request(store, 'POST')).status).toBe(405);
    expect((await request(store, 'GET', `lumastream://elsewhere/${assetId}.png`)).status).toBe(403);
    expect((await request(store, 'GET', 'lumastream://media/not-a-uuid.png')).status).toBe(403);
    expect((await request(store, 'GET', `lumastream://media/${assetId}.exe`)).status).toBe(403);
    expect((await request(store, 'GET', `${assetUrl}?download=1`)).status).toBe(403);

    const missingResponse = await request(store, 'GET', 'lumastream://media/123e4567-e89b-12d3-a456-426614174001.png');
    expect(missingResponse.status).toBe(404);

    const invalidRange = await request(store, 'GET', assetUrl, 'bytes=20-30');
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get('content-range')).toBe('bytes */10');
  });
});

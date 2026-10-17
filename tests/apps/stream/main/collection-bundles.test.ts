// @vitest-environment node
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

const mockDialog = { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() };

import { CollectionBundleStore } from '../../../../apps/stream/main/collection-bundles';
import { MediaAssetStore } from '../../../../apps/stream/main/media-assets';
import { ProjectStore } from '../../../../apps/stream/main/project-store';
import { createDefaultProject } from '../../../../apps/stream/shared/desktop-api';

const temporaryDirectories: string[] = [];
const sourceAssetId = 'f53a46ac-0bd4-4cab-8ab1-3d7c5a66f0af';

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function bundleStore(projects: ProjectStore, media: MediaAssetStore): CollectionBundleStore {
  return new CollectionBundleStore(projects, media, () => ({ isDestroyed: () => false }) as BrowserWindow, mockDialog);
}

afterEach(async () => {
  mockDialog.showSaveDialog.mockReset();
  mockDialog.showOpenDialog.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('LumaStream scene collection bundles', () => {
  it('exports referenced media and imports it with a fresh asset ID', async () => {
    const sourceData = await temporaryDirectory('lumastream-bundle-source-');
    const sourceStore = new ProjectStore(sourceData);
    const sourceWorkspace = await sourceStore.load();
    const mediaDirectory = path.join(sourceData, 'media');
    await mkdir(mediaDirectory, { recursive: true });
    const mediaBytes = Buffer.from('portable image bytes');
    await writeFile(path.join(mediaDirectory, `${sourceAssetId}.png`), mediaBytes);
    const project = createDefaultProject();
    project.scenes[0]!.sources.push({
      id: 'portable-image', name: 'Backdrop', kind: 'image', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: project.output.width, height: project.output.height },
      assetId: sourceAssetId, assetExtension: 'png', mediaKind: 'image',
    });
    await sourceStore.save(sourceWorkspace.activeCollectionId, sourceWorkspace.activeProfileId, project);

    const archivePath = path.join(sourceData, 'Portable Collection.lumacollection');
    mockDialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: archivePath });
    const sourceMedia = new MediaAssetStore(sourceData, () => null);
    await expect(bundleStore(sourceStore, sourceMedia).exportCollection(sourceWorkspace.activeCollectionId)).resolves.toBe(true);

    const destinationData = await temporaryDirectory('lumastream-bundle-destination-');
    const destinationStore = new ProjectStore(destinationData);
    const destinationMedia = new MediaAssetStore(destinationData, () => null);
    const imported = await bundleStore(destinationStore, destinationMedia).importFromPath(archivePath);
    const importedSource = imported.project.scenes[0]?.sources.find((source) => source.id === 'portable-image');

    expect(importedSource?.assetId).toBeDefined();
    expect(importedSource?.assetId).not.toBe(sourceAssetId);
    await expect(readFile(path.join(destinationData, 'media', `${importedSource?.assetId}.png`))).resolves.toEqual(mediaBytes);
  });

  it('bundles and remaps every image referenced by a slideshow', async () => {
    const sourceData = await temporaryDirectory('lumastream-slideshow-bundle-source-');
    const sourceStore = new ProjectStore(sourceData);
    const sourceWorkspace = await sourceStore.load();
    const mediaDirectory = path.join(sourceData, 'media');
    await mkdir(mediaDirectory, { recursive: true });
    const slideIds = [sourceAssetId, '7d6a4197-07f8-4a4b-843b-593fb7849184'];
    const slideBytes = [Buffer.from('first slide bytes'), Buffer.from('second slide bytes')];
    await Promise.all(slideIds.map((id, index) => writeFile(path.join(mediaDirectory, `${id}.png`), slideBytes[index]!)));
    const project = createDefaultProject();
    project.scenes[0]!.sources.push({
      id: 'portable-slideshow', name: 'Slides', kind: 'slideshow', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: project.output.width, height: project.output.height },
      slideshowImages: slideIds.map((assetId, index) => ({ assetId, assetExtension: 'png', name: `Slide ${index + 1}` })),
      slideshowIntervalSeconds: 5,
      slideshowLoop: true,
    });
    await sourceStore.save(sourceWorkspace.activeCollectionId, sourceWorkspace.activeProfileId, project);

    const archivePath = path.join(sourceData, 'Slideshow Collection.lumacollection');
    mockDialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: archivePath });
    await expect(bundleStore(sourceStore, new MediaAssetStore(sourceData, () => null)).exportCollection(sourceWorkspace.activeCollectionId)).resolves.toBe(true);

    const destinationData = await temporaryDirectory('lumastream-slideshow-bundle-destination-');
    const destinationStore = new ProjectStore(destinationData);
    const imported = await bundleStore(destinationStore, new MediaAssetStore(destinationData, () => null)).importFromPath(archivePath);
    const source = imported.project.scenes[0]?.sources.find((item) => item.id === 'portable-slideshow');
    expect(source?.kind).toBe('slideshow');
    expect(source?.slideshowImages).toHaveLength(2);
    for (const [index, image] of (source?.slideshowImages ?? []).entries()) {
      expect(image.assetId).not.toBe(slideIds[index]);
      await expect(readFile(path.join(destinationData, 'media', `${image.assetId}.png`))).resolves.toEqual(slideBytes[index]);
    }
  });

  it('rejects archives containing paths outside the bundle layout', async () => {
    const dataDirectory = await temporaryDirectory('lumastream-bundle-invalid-');
    const archivePath = path.join(dataDirectory, 'invalid.zip');
    const archive = new ZipFile();
    const safeEntryName = 'aaaaaaaaaaa';
    archive.addBuffer(Buffer.from('unexpected'), safeEntryName);
    archive.end();
    await pipeline(archive.outputStream, createWriteStream(archivePath));
    const bytes = await readFile(archivePath);
    const maliciousEntryName = Buffer.from('../evil.txt');
    const safeEntryBytes = Buffer.from(safeEntryName);
    let offset = 0;
    let replacements = 0;
    while ((offset = bytes.indexOf(safeEntryBytes, offset)) >= 0) {
      maliciousEntryName.copy(bytes, offset);
      offset += maliciousEntryName.length;
      replacements += 1;
    }
    expect(replacements).toBe(2);
    await writeFile(archivePath, bytes);

    const store = new ProjectStore(dataDirectory);
    const media = new MediaAssetStore(dataDirectory, () => null);
    await expect(bundleStore(store, media).importFromPath(archivePath)).rejects.toThrow(/invalid relative path|unexpected file path/);
  });
});

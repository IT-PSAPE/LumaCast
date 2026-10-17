import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { BrowserWindow, dialog } from 'electron';
import { open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CaptureKind, MediaKind, RecordingOutputSettings, StreamAPI, StreamGlobalHotkeys, StreamOutputSettings, StreamProject } from '../shared/desktop-api';
import { DesktopCaptureController } from './desktop-capture';
import { BrowserSourceManager } from './browser-sources';
import { IPC_CHANNELS } from './ipc-channels';
import { MediaAssetStore } from './media-assets';
import { ProjectStore } from './project-store';
import { RecordingStore } from './recording-store';
import { RecordingRemuxer } from './recording-remuxer';
import { StreamOutput } from './stream-output';
import { GlobalHotkeyManager } from './global-hotkeys';
import { CollectionBundleStore } from './collection-bundles';
import { ApplicationAudioCapture } from './application-audio-capture';

function isTrustedInvocation(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  contents: WebContents,
  isTrustedUrl: (url: string) => boolean,
): boolean {
  return event.sender === contents && event.senderFrame !== null
    && event.senderFrame === contents.mainFrame && isTrustedUrl(event.senderFrame.url);
}

function profileFileStem(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || 'Stream Profile';
}

export function registerStreamIpc(
  projectStore: ProjectStore,
  capture: DesktopCaptureController,
  mediaAssets: MediaAssetStore,
  collectionBundles: CollectionBundleStore,
  recordings: RecordingStore,
  recordingRemuxer: RecordingRemuxer,
  streamOutput: StreamOutput,
  browserSources: BrowserSourceManager,
  globalHotkeys: GlobalHotkeyManager,
  applicationAudio: ApplicationAudioCapture,
  getContents: () => WebContents | null,
  isTrustedUrl: (url: string) => boolean,
): () => void {
  const authorize = (event: IpcMainInvokeEvent): WebContents => {
    const contents = getContents();
    if (!contents || !isTrustedInvocation(event, contents, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
    return contents;
  };
  const handlers: Array<[string, (event: IpcMainInvokeEvent, ...args: any[]) => unknown]> = [
    [IPC_CHANNELS.loadProject, (event) => { authorize(event); return projectStore.load(); }],
    [IPC_CHANNELS.saveProject, (event, collectionId: string, profileId: string, project: StreamProject) => {
      authorize(event);
      if (typeof collectionId !== 'string' || collectionId.length > 128) throw new Error('Invalid scene collection.');
      if (typeof profileId !== 'string' || profileId.length > 128) throw new Error('Invalid profile.');
      return projectStore.save(collectionId, profileId, project);
    }],
    [IPC_CHANNELS.createCollection, (event, name: string, duplicateCurrent: boolean) => {
      authorize(event);
      if (typeof duplicateCurrent !== 'boolean') throw new Error('Invalid collection operation.');
      return projectStore.create(name, duplicateCurrent);
    }],
    [IPC_CHANNELS.activateCollection, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid scene collection.');
      return projectStore.activate(id);
    }],
    [IPC_CHANNELS.renameCollection, (event, id: string, name: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid scene collection.');
      return projectStore.rename(id, name);
    }],
    [IPC_CHANNELS.deleteCollection, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid scene collection.');
      return projectStore.delete(id);
    }],
    [IPC_CHANNELS.importCollection, (event) => { authorize(event); return collectionBundles.importCollection(); }],
    [IPC_CHANNELS.exportCollection, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid scene collection.');
      return collectionBundles.exportCollection(id);
    }],
    [IPC_CHANNELS.createProfile, (event, name: string, duplicateCurrent: boolean) => {
      authorize(event);
      if (typeof duplicateCurrent !== 'boolean') throw new Error('Invalid profile operation.');
      return projectStore.createProfile(name, duplicateCurrent);
    }],
    [IPC_CHANNELS.activateProfile, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid profile.');
      return projectStore.activateProfile(id);
    }],
    [IPC_CHANNELS.renameProfile, (event, id: string, name: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid profile.');
      return projectStore.renameProfile(id, name);
    }],
    [IPC_CHANNELS.deleteProfile, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid profile.');
      return projectStore.deleteProfile(id);
    }],
    [IPC_CHANNELS.importProfile, async (event) => {
      const window = BrowserWindow.fromWebContents(authorize(event));
      if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
      const result = await dialog.showOpenDialog(window, {
        title: 'Import Profile',
        properties: ['openFile'],
        filters: [{ name: 'LumaStream Profile', extensions: ['lumaprofile', 'json'] }],
      });
      const filePath = result.filePaths[0];
      if (result.canceled || !filePath) return null;
      const handle = await open(filePath, 'r');
      let bytes: Buffer;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size < 1 || info.size > 4 * 1024 * 1024) throw new Error('The profile file is empty or too large.');
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      return projectStore.importProfile(JSON.parse(bytes.toString('utf8')));
    }],
    [IPC_CHANNELS.exportProfile, async (event, id: string) => {
      const window = BrowserWindow.fromWebContents(authorize(event));
      if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid profile.');
      const document = await projectStore.exportProfile(id);
      const result = await dialog.showSaveDialog(window, {
        title: 'Export Profile',
        defaultPath: `${profileFileStem(document.name)}.lumaprofile`,
        filters: [{ name: 'LumaStream Profile', extensions: ['lumaprofile'] }],
      });
      if (result.canceled || !result.filePath) return false;
      const filePath = path.extname(result.filePath).toLowerCase() === '.lumaprofile' ? result.filePath : `${result.filePath}.lumaprofile`;
      await writeFile(filePath, JSON.stringify(document, null, 2), 'utf8');
      return true;
    }],
    [IPC_CHANNELS.listDesktopSources, (event, kind: CaptureKind) => {
      authorize(event);
      if (kind !== 'screen' && kind !== 'window') throw new Error('Unsupported capture source type.');
      return capture.list(kind);
    }],
    [IPC_CHANNELS.prepareDesktopCapture, (event, sourceId: string, includeSystemAudio: boolean) => {
      const contents = authorize(event);
      return capture.prepare(contents.id, sourceId, includeSystemAudio);
    }],
    [IPC_CHANNELS.listAudioApplications, (event) => { authorize(event); return applicationAudio.list(); }],
    [IPC_CHANNELS.startApplicationAudioCapture, (event, sourceId: string, pid: number, executablePath: string) => {
      const contents = authorize(event);
      if (typeof sourceId !== 'string' || sourceId.length > 256 || !Number.isSafeInteger(pid) || pid < 1
        || typeof executablePath !== 'string' || executablePath.length < 1 || executablePath.length > 32768) {
        throw new Error('Invalid application-audio capture request.');
      }
      return applicationAudio.start(sourceId, contents, pid, executablePath);
    }],
    [IPC_CHANNELS.stopApplicationAudioCapture, (event, sourceId: string) => {
      authorize(event);
      if (typeof sourceId !== 'string' || sourceId.length > 256) throw new Error('Invalid application-audio source ID.');
      applicationAudio.stop(sourceId);
    }],
    [IPC_CHANNELS.importMedia, (event, kind: MediaKind) => {
      authorize(event);
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio') throw new Error('Unsupported media type.');
      return mediaAssets.chooseAndImport(kind);
    }],
    [IPC_CHANNELS.remuxRecording, (event) => { authorize(event); return recordingRemuxer.remux(); }],
    [IPC_CHANNELS.openRecording, (event, settings: RecordingOutputSettings) => { authorize(event); return recordings.open(settings); }],
    [IPC_CHANNELS.writeRecordingChunk, (event, id: string, track: number, bytes: ArrayBuffer) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid recording session.');
      return recordings.write(id, track, bytes);
    }],
    [IPC_CHANNELS.closeRecording, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid recording session.');
      return recordings.close(id);
    }],
    [IPC_CHANNELS.abortRecording, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid recording session.');
      return recordings.abort(id);
    }],
    [IPC_CHANNELS.startStreaming, (event, destination: string, settings: StreamOutputSettings) => {
      authorize(event);
      return streamOutput.start(destination, settings);
    }],
    [IPC_CHANNELS.writeStreamingChunk, (event, id: string, bytes: ArrayBuffer) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid streaming session.');
      return streamOutput.write(id, bytes);
    }],
    [IPC_CHANNELS.stopStreaming, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid streaming session.');
      return streamOutput.stop(id);
    }],
    [IPC_CHANNELS.setGlobalHotkeys, (event, hotkeys: StreamGlobalHotkeys, sceneSwitchHotkeys: Record<string, string>, sourceVisibilityHotkeys: Record<string, string>) => {
      authorize(event);
      globalHotkeys.set(hotkeys, sceneSwitchHotkeys, sourceVisibilityHotkeys);
    }],
    [IPC_CHANNELS.createBrowserSource, (event, id: string, url: string, width: number, height: number) => {
      authorize(event);
      return browserSources.create(id, url, width, height);
    }],
    [IPC_CHANNELS.getBrowserSourceAudioCaptureId, (event, id: string) => {
      const contents = authorize(event);
      return browserSources.getAudioCaptureId(id, contents);
    }],
    [IPC_CHANNELS.closeBrowserSource, (event, id: string) => {
      authorize(event);
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid browser source.');
      browserSources.close(id);
    }],
  ];
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler);
  return () => { for (const [channel] of handlers) ipcMain.removeHandler(channel); };
}

export type { StreamAPI };

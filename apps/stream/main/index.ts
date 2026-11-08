import { app, dialog, ipcMain, nativeImage, protocol, session, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import { DesktopCaptureController } from './desktop-capture';
import { BrowserSourceManager } from './browser-sources';
import { registerStreamIpc } from './ipc';
import { IPC_CHANNELS } from './ipc-channels';
import { MediaAssetStore, MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES } from './media-assets';
import { isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';
import { ProjectStore } from './project-store';
import { RecordingStore } from './recording-store';
import { RecordingRemuxer } from './recording-remuxer';
import { StreamOutput } from './stream-output';
import { GlobalHotkeyManager } from './global-hotkeys';
import { CollectionBundleStore } from './collection-bundles';
import { ApplicationAudioCapture } from './application-audio-capture';
import { AudioSettingsStore } from './audio-settings-store';
import { RecordingPreferencesStore } from './recording-preferences-store';
import { StreamSettingsStore } from './stream-settings-store';
import { YouTubeLiveService } from './youtube-live';
import { ZoomLiveService } from './zoom-live';
import { ZoomSdkStreaming } from './zoom-sdk-streaming';
import { allowsSpeakerSelection } from './audio-output-permissions';
import { applyApplicationMenu } from './application-menu';
import { createMainWindow } from './window';
import { applicationAudioHelperFilename, toStreamPlatform } from '../shared/platform-capabilities';
import { registerNdiIpc } from './ndi-bridge';
import { PresentationImporter } from './presentation-import';
import { WorkspaceShutdown } from './workspace-shutdown';

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES }]);
app.setName('LumaStream');
const dataDirectory = path.join(app.getPath('appData'), 'LumaStream');
app.setPath('userData', path.join(dataDirectory, 'user-data'));

let mainWindow: BrowserWindow | null = null;
const platform = toStreamPlatform(process.platform);
const projectStore = new ProjectStore(dataDirectory, { platform });
const audioSettings = new AudioSettingsStore(dataDirectory);
const recordingPreferences = new RecordingPreferencesStore(dataDirectory);
const streamSettings = new StreamSettingsStore(dataDirectory);
const capture = new DesktopCaptureController(() => mainWindow);
const mediaAssets = new MediaAssetStore(dataDirectory, () => mainWindow);
const presentations = new PresentationImporter(mediaAssets, () => mainWindow, path.join(__dirname, 'presentation-worker.js'), {
  fontDirectory: app.isPackaged ? path.join(process.resourcesPath, 'presentation-fonts') : undefined,
});
const recordings = new RecordingStore(() => mainWindow, app.getPath('videos'), recordingPreferences);
const recordingRemuxer = new RecordingRemuxer(() => mainWindow);
const streamOutput = new StreamOutput(() => mainWindow?.webContents ?? null);
const youtubeLive = new YouTubeLiveService(dataDirectory, streamOutput, process.env.LUMASTREAM_GOOGLE_CLIENT_ID ?? '', (url) => shell.openExternal(url));
const zoomLive = new ZoomLiveService(
  dataDirectory,
  process.env.LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID ?? '',
  (url) => shell.openExternal(url),
  undefined,
  undefined,
  process.env.LUMASTREAM_ZOOM_CLIENT_ID ?? '',
  process.env.LUMASTREAM_ZOOM_CLIENT_SECRET ?? '',
);
const zoomStreaming = new ZoomSdkStreaming(zoomLive, () => mainWindow?.webContents ?? null);
const browserSources = new BrowserSourceManager(() => mainWindow?.webContents ?? null);
const globalHotkeys = new GlobalHotkeyManager(() => mainWindow?.webContents ?? null);
// Windows ships the .NET WASAPI process-loopback helper; macOS ships the Objective-C Core Audio tap helper.
// Other platforms get a path that never exists, so the helper reports a clear spawn failure instead of crashing startup.
const applicationAudioHelperName = applicationAudioHelperFilename(platform) ?? 'unsupported-audio-helper';
const applicationAudioHelperPath = app.isPackaged
  ? path.join(process.resourcesPath, 'application-audio', applicationAudioHelperName)
  : path.join(app.getAppPath(), 'native', platform === 'darwin' ? path.join('audio-tap', 'build') : path.join('audio-loopback', 'publish'), applicationAudioHelperName);
const applicationAudio = new ApplicationAudioCapture(applicationAudioHelperPath);
const collectionBundles = new CollectionBundleStore(projectStore, mediaAssets, () => mainWindow);
const rendererFile = path.join(__dirname, '../renderer/index.html');
const devServerOrigin = resolveDevServerOrigin(process.env.ELECTRON_RENDERER_URL);
const isTrustedUrl = (url: string) => isTrustedRendererUrl(url, { packagedRendererFile: rendererFile, devServerOrigin });
const unregisterIpc = registerStreamIpc(projectStore, audioSettings, recordingPreferences, capture, mediaAssets, presentations, collectionBundles, recordings, recordingRemuxer, streamOutput, browserSources, globalHotkeys, applicationAudio, streamSettings, youtubeLive, zoomLive, zoomStreaming, () => mainWindow?.webContents ?? null, isTrustedUrl);
const ndiIpc = registerNdiIpc(
  () => mainWindow?.webContents ?? null,
  isTrustedUrl,
  path.join(__dirname, 'ndi-host.js'),
);

const workspaceShutdown = new WorkspaceShutdown(ipcMain, () => mainWindow?.webContents ?? null, isTrustedUrl, () => projectStore.flush());
let shutdownComplete = false;
let shutdownTask: Promise<void> | null = null;
let closeTask: Promise<void> | null = null;
let reloadTask: Promise<void> | null = null;
let closeApproved = false;
let reloadApproved = false;
const showSaveError = (error: unknown) => {
  dialog.showErrorBox('Stream could not save project settings', error instanceof Error ? error.message : 'Project settings could not be saved. Try closing Stream again.');
};
app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownTask) return;
  shutdownTask = workspaceShutdown.flush().then(async () => {
    browserSources.closeAll();
    applicationAudio.stopAll();
    await Promise.allSettled([youtubeLive.stopAll(), streamOutput.stopAll(), recordings.closeAll(), ndiIpc.close()]);
    zoomStreaming.stopAll();
    shutdownComplete = true;
    app.quit();
  }).catch(showSaveError).finally(() => { shutdownTask = null; });
});

if (app.requestSingleInstanceLock()) {
  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      app.dock?.setIcon(nativeImage.createFromPath(path.join(app.getAppPath(), 'resources/icon-mac.png')));
    }
    return protocol.handle(MEDIA_SCHEME, mediaAssets.handler());
  }).then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const trusted = webContents === mainWindow?.webContents && webContents.mainFrame.url !== '' && isTrustedUrl(webContents.mainFrame.url);
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
      const emptyMediaPreflight = mediaTypes === undefined || mediaTypes.length === 0;
      const allowedMedia = permission === 'media' && trusted
        && ((mediaTypes !== undefined && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio' || type === 'video'))
          || (emptyMediaPreflight && (capture.authorizeEmptyMediaTypesPermissionRequest(webContents.id)
            || browserSources.isAudioCaptureAuthorized(webContents.id))));
      const allowedDisplayCapture = (permission as string) === 'display-capture' && trusted
        && (capture.isCaptureAuthorized(webContents.id) || browserSources.isAudioCaptureAuthorized(webContents.id));
      const allowedSpeakerSelection = allowsSpeakerSelection(
        permission,
        trusted,
        details.isMainFrame,
        isTrustedUrl(details.requestingUrl),
      );
      const allowed = allowedMedia || allowedDisplayCapture || allowedSpeakerSelection;
      callback(allowed);
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
      const trusted = webContents === mainWindow?.webContents && isTrustedUrl(webContents.mainFrame.url);
      const allowedMedia = permission === 'media' && trusted
        && (details.mediaType === 'audio' || details.mediaType === 'video'
          || (details.mediaType === undefined && (capture.isCaptureAuthorized(webContents.id)
            || capture.isAutomaticCaptureAuthorized(webContents.id)
            || browserSources.isAudioCaptureAuthorized(webContents.id))));
      const allowedDisplayCapture = (permission as string) === 'display-capture' && trusted
        && (capture.isCaptureAuthorized(webContents.id) || browserSources.isAudioCaptureAuthorized(webContents.id));
      return allowedMedia || allowedDisplayCapture || allowsSpeakerSelection(
        permission,
        trusted,
        details.isMainFrame,
        details.requestingUrl !== undefined && isTrustedUrl(details.requestingUrl),
      );
    });
    capture.register();
    mainWindow = createMainWindow();
    mainWindow.on('close', (event) => {
      if (closeApproved || shutdownComplete) return;
      event.preventDefault();
      if (closeTask || shutdownTask) return;
      closeTask = workspaceShutdown.flush().then(() => {
        closeApproved = true;
        mainWindow?.close();
      }).catch(showSaveError).finally(() => { closeTask = null; });
    });
    // Windows session shutdown skips app's before-quit; cancel the session
    // close and enter the same graceful persistence/output teardown path.
    mainWindow.on('query-session-end', (event) => { event.preventDefault(); app.quit(); });
    mainWindow.webContents.on('will-prevent-unload', (event) => {
      // Ignore the renderer's app-owned beforeunload prevention only after
      // persistence has approved this close, quit, or one reload.
      if (closeApproved || shutdownComplete || reloadApproved) {
        reloadApproved = false;
        event.preventDefault();
        return;
      }
      if (reloadTask || closeTask || shutdownTask) return;
      const contents = mainWindow?.webContents;
      reloadTask = workspaceShutdown.flush().then(() => {
        if (closeTask || shutdownTask || !contents || contents.isDestroyed() || contents !== mainWindow?.webContents) return;
        reloadApproved = true;
        contents.reload();
      }).catch(showSaveError).finally(() => { reloadTask = null; });
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    // Replaces Electron's generic default application menu immediately; the
    // renderer sends its real File/Edit/.../Help template (see
    // `stream:set-application-menu`) a moment after mount.
    applyApplicationMenu([], (id) => {
      const contents = mainWindow?.webContents;
      if (contents && !contents.isDestroyed()) contents.send(IPC_CHANNELS.menuAction, id);
    });
  }).catch((error) => {
    console.error('[stream] startup failed', error);
    app.quit();
  });
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.on('window-all-closed', () => app.quit());
} else {
  app.quit();
}

app.on('will-quit', () => {
  unregisterIpc();
  ndiIpc.unregister();
  browserSources.closeAll();
  applicationAudio.stopAll();
  globalHotkeys.unregisterAll();
});

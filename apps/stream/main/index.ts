import { app, protocol, session, type BrowserWindow } from 'electron';
import path from 'node:path';
import { DesktopCaptureController } from './desktop-capture';
import { BrowserSourceManager } from './browser-sources';
import { registerStreamIpc } from './ipc';
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
import { allowsSpeakerSelection } from './audio-output-permissions';
import { createMainWindow } from './window';

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES }]);
app.setName('LumaStream');
const dataDirectory = path.join(app.getPath('appData'), 'LumaStream');
app.setPath('userData', path.join(dataDirectory, 'user-data'));

let mainWindow: BrowserWindow | null = null;
const projectStore = new ProjectStore(dataDirectory);
const audioSettings = new AudioSettingsStore(dataDirectory);
const capture = new DesktopCaptureController(() => mainWindow);
const mediaAssets = new MediaAssetStore(dataDirectory, () => mainWindow);
const recordings = new RecordingStore(() => mainWindow, app.getPath('videos'));
const recordingRemuxer = new RecordingRemuxer(() => mainWindow);
const streamOutput = new StreamOutput(() => mainWindow?.webContents ?? null);
const browserSources = new BrowserSourceManager(() => mainWindow?.webContents ?? null);
const globalHotkeys = new GlobalHotkeyManager(() => mainWindow?.webContents ?? null);
const applicationAudioHelperPath = app.isPackaged
  ? path.join(process.resourcesPath, 'application-audio', 'AudioLoopback.exe')
  : path.join(app.getAppPath(), 'native', 'audio-loopback', 'publish', 'AudioLoopback.exe');
const applicationAudio = new ApplicationAudioCapture(applicationAudioHelperPath);
const collectionBundles = new CollectionBundleStore(projectStore, mediaAssets, () => mainWindow);
const rendererFile = path.join(__dirname, '../renderer/index.html');
const devServerOrigin = resolveDevServerOrigin(process.env.ELECTRON_RENDERER_URL);
const isTrustedUrl = (url: string) => isTrustedRendererUrl(url, { packagedRendererFile: rendererFile, devServerOrigin });
const unregisterIpc = registerStreamIpc(projectStore, audioSettings, capture, mediaAssets, collectionBundles, recordings, recordingRemuxer, streamOutput, browserSources, globalHotkeys, applicationAudio, () => mainWindow?.webContents ?? null, isTrustedUrl);

let shutdownComplete = false;
app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  browserSources.closeAll();
  applicationAudio.stopAll();
  void Promise.all([streamOutput.stopAll(), recordings.closeAll()]).finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});

if (app.requestSingleInstanceLock()) {
  app.whenReady().then(() => {
    return protocol.handle(MEDIA_SCHEME, mediaAssets.handler());
  }).then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const trusted = webContents === mainWindow?.webContents && webContents.mainFrame.url !== '' && isTrustedUrl(webContents.mainFrame.url);
      const allowedMedia = permission === 'media' && trusted
        && (!('mediaTypes' in details) || details.mediaTypes?.every((type) => type === 'audio' || type === 'video') !== false);
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
        && (details.mediaType === undefined || details.mediaType === 'audio' || details.mediaType === 'video');
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
    mainWindow.on('closed', () => { mainWindow = null; });
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
  browserSources.closeAll();
  applicationAudio.stopAll();
  globalHotkeys.unregisterAll();
});

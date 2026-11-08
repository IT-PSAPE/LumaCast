import { resolveAppElectron } from '../../../../tool/app-electron.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const root = process.cwd();
const playwrightRequire = createRequire(path.resolve('package.json'));
const { _electron: electron, expect } = playwrightRequire('@playwright/test');
const { binaryPath: electronBinary, version: electronVersion } = resolveAppElectron('stream');
const outputRoot = path.resolve('output/playwright/provider-docks-review');

const channels = {
  getYouTubeAccount: 'stream:get-youtube-account',
  connectYouTubeAccount: 'stream:connect-youtube-account',
  disconnectYouTubeAccount: 'stream:disconnect-youtube-account',
  listYouTubeBroadcasts: 'stream:list-youtube-broadcasts',
  getYouTubeLiveDetails: 'stream:get-youtube-live-details',
  createYouTubeBroadcast: 'stream:create-youtube-broadcast',
  startYouTubeStreaming: 'stream:start-youtube-output',
  startStreaming: 'stream:start-output',
  getZoomAccount: 'stream:get-zoom-account',
  connectZoomAccount: 'stream:connect-zoom-account',
  disconnectZoomAccount: 'stream:disconnect-zoom-account',
  listZoomMeetings: 'stream:list-zoom-meetings',
  createZoomMeeting: 'stream:create-zoom-meeting',
  startZoomStreaming: 'stream:start-zoom-output',
  stopZoomStreaming: 'stream:stop-zoom-output',
  writeStreamingChunk: 'stream:write-output-chunk',
  stopStreaming: 'stream:stop-output',
  streamStatus: 'stream:output-status',
  zoomMediaPort: 'stream:zoom-media-port',
  ndiStartSend: 'stream:ndi-start-send',
  ndiSendVideo: 'stream:ndi-send-video',
  ndiSendAudio: 'stream:ndi-send-audio',
  ndiStopSend: 'stream:ndi-stop-send',
};

const relevantFiles = [
  'apps/stream/renderer/App.tsx',
  'apps/stream/renderer/style.css',
  'apps/stream/renderer/docks/dock-header.tsx',
  'apps/stream/renderer/docks/dock-header.css',
  'apps/stream/renderer/docks/youtube-dock.tsx',
  'apps/stream/renderer/docks/youtube-dock.css',
  'apps/stream/renderer/docks/youtube-stream-details.tsx',
  'apps/stream/renderer/docks/youtube-stream-row.tsx',
  'apps/stream/renderer/docks/zoom-dock.tsx',
  'apps/stream/renderer/docks/zoom-dock.css',
  'apps/stream/renderer/docks/zoom-dialogs.tsx',
  'apps/stream/renderer/docks/controls-dock.tsx',
  'apps/stream/renderer/docks/controls-dock.css',
  'apps/stream/renderer/features/streaming/use-streaming.ts',
  'apps/stream/renderer/features/streaming/zoom-media-port.ts',
  'apps/stream/renderer/features/streaming/zoom-video-frame.ts',
  'apps/stream/renderer/dialogs/settings-dialog.tsx',
  'apps/stream/renderer/dialogs/settings-dialog.css',
  'apps/stream/renderer/dialogs/settings-draft.ts',
  'apps/stream/main/preload.ts',
  'apps/stream/main/ipc.ts',
  'apps/stream/main/ipc-channels.ts',
  'apps/stream/main/zoom-sdk-streaming.ts',
  'apps/stream/main/youtube-live.ts',
  'apps/stream/shared/desktop-api.ts',
  'apps/stream/renderer/assets/youtube/youtube-icon.svg',
  'apps/stream/renderer/assets/zoom/brand-zoom.svg',
  'apps/stream/renderer/assets/zoom/calendar-days.svg',
];

function environment() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  return env;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function closeApp(app) {
  if (!app) return;
  const child = app.process();
  let timer;
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise((resolve) => { timer = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 5000); }),
  ]);
  clearTimeout(timer);
}

async function interfaceFingerprint() {
  const hash = createHash('sha256');
  for (const relativePath of relevantFiles) {
    try {
      hash.update(relativePath);
      hash.update(await fs.readFile(path.join(root, relativePath)));
    } catch {
      hash.update(`${relativePath}:missing`);
    }
  }
  return hash.digest('hex');
}

async function currentHeadRevision() {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

async function currentRendererAssets() {
  const html = await fs.readFile(path.resolve('apps/stream/out/renderer/index.html'), 'utf8');
  return [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)].map((match) => match[1]);
}

async function writeFixtureBootstrap(runRoot) {
  const bootstrap = path.join(runRoot, 'bootstrap.cjs');
  const appData = path.join(runRoot, 'app-data');
  const mainEntry = path.resolve('apps/stream/out/main/index.js');
  const bootstrapSource = `
const { app, ipcMain, MessageChannelMain } = require('electron');
app.setPath('appData', ${JSON.stringify(appData)});

const channel = ${JSON.stringify(channels)};
const fixture = globalThis.__providerDockFixture = {
  accounts: { youtube: null, zoom: null },
  youtubeAccount: { channelId: 'fixture-channel', channelTitle: 'Fixture Channel' },
  zoomAccount: { userId: 'fixture-user', displayName: 'Fixture Host', email: 'host@example.invalid' },
  broadcasts: [],
  meetings: [],
  details: {},
  calls: [],
  debug: [],
  accountWaiters: [],
  startWaiters: { youtube: [], zoom: [] },
  manualStartWaiters: [],
  manualStartCount: 0,
  manualStartOutputIds: [],
  manualWriteCount: 0,
  manualStopCount: 0,
  holdNdiStart: false,
  holdNdiStop: false,
  ndiStartWaiters: [],
  ndiStopWaiters: [],
  ndiSendStats: { video: 0, audio: 0 },
  holdAccountLookups: false,
  holdStarts: { youtube: false, zoom: false },
  holdManualStart: false,
  failNextList: { youtube: false, zoom: false },
  failNextStart: { youtube: '', zoom: '' },
  zoomPorts: new Map(),
  zoomStartCount: 0,
  zoomSettings: null,
  zoomMediaStats: { videoCount: 0, audioCount: 0, videoSample: null, audioSample: null },
  messageProbe: {},
  releaseAccountLookups() {
    this.holdAccountLookups = false;
    const waiters = this.accountWaiters.splice(0);
    for (const waiter of waiters) waiter();
  },
  releaseStart(service, emitLive = false) {
    this.holdStarts[service] = false;
    const waiters = this.startWaiters[service].splice(0);
    for (const waiter of waiters) waiter({ emitLive });
    return waiters.length;
  },
  releaseManualStart() {
    this.holdManualStart = false;
    const waiters = this.manualStartWaiters.splice(0);
    for (const waiter of waiters) waiter();
    return waiters.length;
  },
  releaseNdiStart() {
    this.holdNdiStart = false;
    const waiters = this.ndiStartWaiters.splice(0);
    for (const waiter of waiters) waiter();
    return waiters.length;
  },
  releaseNdiStop() {
    this.holdNdiStop = false;
    const waiters = this.ndiStopWaiters.splice(0);
    for (const waiter of waiters) waiter();
    return waiters.length;
  },
};

const originalHandle = ipcMain.handle.bind(ipcMain);
const waitForAccount = (service) => fixture.holdAccountLookups
  ? new Promise((resolve) => fixture.accountWaiters.push(() => resolve(fixture.accounts[service])))
  : Promise.resolve(fixture.accounts[service]);
const waitForStart = (service) => fixture.holdStarts[service]
  ? new Promise((resolve) => fixture.startWaiters[service].push(resolve))
  : Promise.resolve({ emitLive: true });
const emit = (contents, status) => {
  if (!contents.isDestroyed()) contents.send(channel.streamStatus, status);
};

const handlers = {
  [channel.getYouTubeAccount]: async () => { fixture.calls.push('getYouTubeAccount'); return waitForAccount('youtube'); },
  [channel.connectYouTubeAccount]: async () => {
    fixture.calls.push('connectYouTubeAccount');
    fixture.accounts.youtube = fixture.youtubeAccount;
    return fixture.youtubeAccount;
  },
  [channel.disconnectYouTubeAccount]: async () => { fixture.calls.push('disconnectYouTubeAccount'); fixture.accounts.youtube = null; },
  [channel.listYouTubeBroadcasts]: async () => {
    fixture.calls.push('listYouTubeBroadcasts');
    if (fixture.failNextList.youtube) { fixture.failNextList.youtube = false; throw new Error('Synthetic YouTube fixture list failure.'); }
    return structuredClone(fixture.broadcasts);
  },
  [channel.getYouTubeLiveDetails]: async (_event, id) => {
    fixture.calls.push('getYouTubeLiveDetails');
    const broadcast = fixture.broadcasts.find((item) => item.id === id);
    const fallbackTitle = id === 'fixture-sunday-service' ? 'Weekly live stream' : broadcast?.title ?? 'Weekly live stream';
    return fixture.details[id] ?? { title: fallbackTitle, currentViewers: null, viewCount: null, health: 'waiting', notices: [] };
  },
  [channel.createYouTubeBroadcast]: async (_event, draft) => {
    fixture.calls.push('createYouTubeBroadcast');
    const created = { id: 'fixture-created-youtube', ...draft, status: 'ready', thumbnailUrl: '' };
    fixture.broadcasts.unshift(created);
    return created;
  },
  [channel.startYouTubeStreaming]: async (event) => {
    fixture.calls.push('startYouTubeStreaming');
    if (fixture.failNextStart.youtube) {
      const message = fixture.failNextStart.youtube;
      fixture.failNextStart.youtube = '';
      throw new Error(message);
    }
    const result = await waitForStart('youtube');
    if (result.emitLive) emit(event.sender, { outputId: 'youtube', state: 'live' });
    return 'fixture-youtube-output';
  },
  [channel.startStreaming]: async (event, _destination, _settings, outputId = 'primary') => {
    fixture.calls.push('startManualStreaming');
    fixture.manualStartCount += 1;
    fixture.manualStartOutputIds.push(outputId);
    emit(event.sender, { outputId, state: 'connecting' });
    if (fixture.holdManualStart) await new Promise((resolve) => fixture.manualStartWaiters.push(resolve));
    emit(event.sender, { outputId, state: 'live' });
    return 'fixture-manual-output-' + fixture.manualStartCount;
  },
  [channel.getZoomAccount]: async () => { fixture.calls.push('getZoomAccount'); return waitForAccount('zoom'); },
  [channel.connectZoomAccount]: async () => {
    fixture.calls.push('connectZoomAccount');
    fixture.accounts.zoom = fixture.zoomAccount;
    return fixture.zoomAccount;
  },
  [channel.disconnectZoomAccount]: async () => { fixture.calls.push('disconnectZoomAccount'); fixture.accounts.zoom = null; },
  [channel.listZoomMeetings]: async () => {
    fixture.calls.push('listZoomMeetings');
    if (fixture.failNextList.zoom) { fixture.failNextList.zoom = false; throw new Error('Synthetic Zoom fixture list failure.'); }
    return structuredClone(fixture.meetings);
  },
  [channel.createZoomMeeting]: async (_event, draft) => {
    fixture.calls.push('createZoomMeeting');
    const created = { id: 'fixture-created-zoom', ...draft, status: 'scheduled' };
    fixture.meetings.unshift(created);
    return created;
  },
  [channel.startZoomStreaming]: async (event, _meetingId, settings) => {
    fixture.calls.push('startZoomStreaming');
    fixture.zoomSettings = settings;
    fixture.debug.push({ type: 'startZoomStreaming', frame: 'handler-entered' });
    if (fixture.failNextStart.zoom) {
      const message = fixture.failNextStart.zoom;
      fixture.failNextStart.zoom = '';
      throw new Error(message);
    }
    const result = await waitForStart('zoom');
    fixture.debug.push({ type: 'startZoomStreaming', frame: 'start-released', result });
    const id = 'fixture-zoom-output-' + (++fixture.zoomStartCount);
    if (result.emitLive) {
      fixture.zoomMediaStats = { videoCount: 0, audioCount: 0, videoSample: null, audioSample: null };
      const messageChannel = new MessageChannelMain();
      messageChannel.port2.on('message', (event) => {
        const type = event.data?.type;
        const data = event.data?.data;
        const sample = {
          mediaType: type,
          dataBytes: data instanceof ArrayBuffer ? data.byteLength : -1,
          width: event.data?.width, height: event.data?.height,
          sampleRate: event.data?.sampleRate, channels: event.data?.channels,
          eventDataKeys: Object.keys(event?.data ?? {}),
          payloadTag: Object.prototype.toString.call(data), payloadConstructor: data?.constructor?.name,
        };
        if (type === 'video') {
          fixture.zoomMediaStats.videoCount += 1;
          fixture.zoomMediaStats.videoSample ??= sample;
        }
        if (type === 'audio') {
          fixture.zoomMediaStats.audioCount += 1;
          fixture.zoomMediaStats.audioSample ??= sample;
        }
        if (type === 'video') messageChannel.port2.postMessage({ type: 'ack', media: 'video' });
        if (type === 'audio') messageChannel.port2.postMessage({ type: 'ack', media: 'audio' });
      });
      messageChannel.port2.start();
      fixture.zoomPorts.set(id, messageChannel.port2);
      event.sender.postMessage(channel.zoomMediaPort, id, [messageChannel.port1]);
      fixture.debug.push({ type: 'media-port-posted', sessionId: id });
      emit(event.sender, { outputId: 'zoom', state: 'connecting', connectionPhase: 'joining' });
      setTimeout(() => emit(event.sender, { outputId: 'zoom', state: 'connecting', connectionPhase: 'starting-output' }), 450);
      setTimeout(() => emit(event.sender, { outputId: 'zoom', state: 'live' }), 900);
    }
    return id;
  },
  [channel.stopZoomStreaming]: async (event, id) => {
    fixture.calls.push('stopZoomStreaming');
    fixture.zoomPorts.get(id)?.close();
    fixture.zoomPorts.delete(id);
    emit(event.sender, { outputId: 'zoom', state: 'stopped' });
  },
  [channel.writeStreamingChunk]: async (_event, id) => {
    if (String(id).startsWith('fixture-manual-output-')) fixture.manualWriteCount += 1;
  },
  [channel.stopStreaming]: async (event, id) => {
    fixture.calls.push('stopStreaming');
    if (String(id).startsWith('fixture-manual-output-')) {
      fixture.manualStopCount += 1;
      emit(event.sender, { outputId: fixture.manualStartOutputIds.at(-1) ?? 'youtube', state: 'stopped' });
    } else {
      emit(event.sender, { outputId: 'youtube', state: 'stopped' });
    }
  },
  [channel.ndiStartSend]: async () => {
    fixture.calls.push('ndiStartSend');
    if (fixture.holdNdiStart) await new Promise((resolve) => fixture.ndiStartWaiters.push(resolve));
    return 'fixture-ndi-output';
  },
  [channel.ndiSendVideo]: async () => { fixture.ndiSendStats.video += 1; },
  [channel.ndiSendAudio]: async () => { fixture.ndiSendStats.audio += 1; },
  [channel.ndiStopSend]: async () => {
    fixture.calls.push('ndiStopSend');
    if (fixture.holdNdiStop) await new Promise((resolve) => fixture.ndiStopWaiters.push(resolve));
  },
};

ipcMain.handle = (name, handler) => originalHandle(name, handlers[name] ?? handler);
require(${JSON.stringify(mainEntry)});
`;
  await fs.mkdir(appData, { recursive: true });
  await fs.writeFile(bootstrap, bootstrapSource, 'utf8');
  return { bootstrap, appData };
}

async function main() {
  const runRoot = path.join(outputRoot, `run-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  await fs.mkdir(runRoot, { recursive: true });
  const { bootstrap } = await writeFixtureBootstrap(runRoot);
  const debugPort = await freePort();
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [`--remote-debugging-port=${debugPort}`, '--autoplay-policy=no-user-gesture-required', bootstrap],
    env: environment(),
    timeout: 30000,
  });

  const rendererErrors = [];
  const checks = [];
  const screenshots = [];
  const measurements = {};
  let page;
  const record = (name, evidence) => checks.push({ name, status: 'PASS', evidence });
  const fixture = async (callback, value) => app.evaluate(callback, value);
  const snapshotDock = async (selector, name) => {
    const file = path.join(runRoot, name);
    await page.mouse.move(780, 350);
    await page.locator(selector).screenshot({ path: file });
    screenshots.push(path.relative(root, file));
  };

  try {
    page = await app.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push(error.message));
    page.on('console', (entry) => { if (entry.type() === 'error') rendererErrors.push(entry.text()); });
    await fixture(() => { globalThis.__providerDockFixture.holdAccountLookups = true; });
    await page.addInitScript(() => {
      window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.source !== 'lumastream-main'
          || event.data.type !== 'zoom-media-port' || !event.ports[0]) return;
        const mode = event.data.sessionId === 'fixture-message-probe-transfer' ? 'transfer'
          : event.data.sessionId === 'fixture-message-probe-clone' ? 'clone' : null;
        if (!mode) return;
        event.stopImmediatePropagation();
        const data = new Uint8Array([1, 2, 3, 4]).buffer;
        const message = { type: 'probe', data, width: 2, height: 1 };
        if (mode === 'transfer') event.ports[0].postMessage(message, [data]);
        else event.ports[0].postMessage(message);
      });
      const layout = {
        dockWeights: { youtube: 0.538, controls: 1.924, zoom: 0.538 },
        bottomPanelHeight: 320,
        hiddenDocks: ['scenes', 'sources', 'mixer'],
        dockOrder: ['youtube', 'controls', 'zoom', 'scenes', 'sources', 'mixer'],
      };
      localStorage.setItem('lumastream.workbench-layout', JSON.stringify(layout));
    });
    await page.reload();
    const youtubeDock = page.locator('.youtube-dock');
    const zoomDock = page.locator('.zoom-dock');
    const controlsDock = page.locator('.controls-dock');
    await expect(youtubeDock).toBeVisible();
    await expect(zoomDock).toBeVisible();
    await expect(controlsDock).toBeVisible();
    await expect(youtubeDock.locator('.youtube-dock-body')).toContainText('Loading streams');
    await expect(zoomDock.locator('.zoom-dock-body')).toContainText('Loading meetings');
    await fixture(({ BrowserWindow, MessageChannelMain }, values) => {
      const fixture = globalThis.__providerDockFixture;
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      for (const mode of ['transfer', 'clone']) {
        const channel = new MessageChannelMain();
        channel.port2.on('message', (event) => {
          const data = event?.data;
          fixture.messageProbe[mode] = {
            type: data?.type,
            envelopeKeys: Object.keys(data ?? {}),
            payloadTag: Object.prototype.toString.call(data?.data),
            payloadConstructor: data?.data?.constructor?.name,
            payloadByteLength: data?.data?.byteLength,
            width: data?.width,
            height: data?.height,
          };
          channel.port2.close();
        });
        channel.port2.start();
        window.webContents.postMessage(values.channel, `fixture-message-probe-${mode}`, [channel.port1]);
      }
    }, { channel: channels.zoomMediaPort });
    await expect.poll(() => fixture(() => Object.keys(globalThis.__providerDockFixture.messageProbe))).toHaveLength(2);
    const messageProbe = await fixture(() => globalThis.__providerDockFixture.messageProbe);
    measurements.messageProbe = messageProbe;
    assert.deepEqual(messageProbe.clone, {
      type: 'probe', envelopeKeys: ['type', 'data', 'width', 'height'], payloadTag: '[object ArrayBuffer]',
      payloadConstructor: 'ArrayBuffer', payloadByteLength: 4, width: 2, height: 1,
    }, 'The no-transfer structured-clone probe should preserve an object and its ArrayBuffer payload.');
    record('Electron 44 MessageChannelMain transfer-list vs structured-clone diagnostic; clone envelope remains intact', JSON.stringify(messageProbe));
    await snapshotDock('.youtube-dock', 'youtube-loading-280.png');
    await snapshotDock('.zoom-dock', 'zoom-loading-280.png');
    record('Loading states render at the 280 × 320 reference size', 'youtube-loading-280.png; zoom-loading-280.png');

    await fixture(() => globalThis.__providerDockFixture.releaseAccountLookups());
    await expect(youtubeDock.locator('.youtube-dock-body')).toContainText('Not connected');
    await expect(zoomDock.locator('.zoom-dock-body')).toContainText('Connect Zoom');
    await snapshotDock('.youtube-dock', 'youtube-disconnected-280.png');
    await snapshotDock('.zoom-dock', 'zoom-disconnected-280.png');
    record('Disconnected states provide an actionable connect path', 'youtube-disconnected-280.png; zoom-disconnected-280.png');

    await page.getByRole('button', { name: 'Connect YouTube', exact: true }).click();
    const youtubeSettings = page.getByRole('dialog', { name: 'YouTube settings' });
    await expect(youtubeSettings).toBeVisible();
    await youtubeSettings.getByRole('button', { name: 'Connect YouTube', exact: true }).click();
    await expect(youtubeSettings.getByText('Fixture Channel')).toBeVisible();
    await youtubeSettings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(youtubeDock.locator('.youtube-dock-body')).toContainText('No scheduled stream');

    await page.getByRole('button', { name: 'Connect Zoom', exact: true }).click();
    const zoomSettings = page.getByRole('dialog', { name: 'Zoom settings' });
    await expect(zoomSettings).toBeVisible();
    await zoomSettings.getByRole('button', { name: 'Connect Zoom', exact: true }).click();
    await expect(zoomSettings.getByText('Fixture Host')).toBeVisible();
    await zoomSettings.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(zoomDock.locator('.zoom-dock-body')).toContainText('No scheduled meetings');
    await snapshotDock('.youtube-dock', 'youtube-empty-280.png');
    await snapshotDock('.zoom-dock', 'zoom-empty-280.png');
    record('Connected empty states offer a create action; account connect remains fixture-local', 'youtube-empty-280.png; zoom-empty-280.png');

    await youtubeDock.getByRole('button', { name: 'New stream', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Create stream' })).toBeVisible();
    await page.keyboard.press('Escape');
    await zoomDock.getByRole('button', { name: 'New meeting', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'New Zoom meeting' })).toBeVisible();
    await page.keyboard.press('Escape');

    const scheduledStartTime = new Date(Date.now() + 86_400_000).toISOString();
    const firstBroadcasts = [
      { id: 'fixture-sunday-service', title: 'Sunday Service', description: 'Synthetic service', scheduledStartTime, status: 'ready', privacy: 'public', thumbnailUrl: '' },
      { id: 'fixture-monday-bread', title: 'Monday Daily Bread', description: 'Synthetic daily stream', scheduledStartTime, status: 'ready', privacy: 'unlisted', thumbnailUrl: '' },
    ];
    const firstMeetings = [
      { id: '1234567890', topic: 'Weekly planning', startTime: scheduledStartTime, durationMinutes: 60, status: 'scheduled' },
      { id: '0987654321', topic: 'Design review', startTime: scheduledStartTime, durationMinutes: 45, status: 'scheduled' },
    ];
    await fixture((_, values) => {
      globalThis.__providerDockFixture.broadcasts = values.broadcasts;
      globalThis.__providerDockFixture.meetings = values.meetings;
    }, { broadcasts: firstBroadcasts, meetings: firstMeetings });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh meetings', exact: true }).click();
    await expect(youtubeDock).toContainText('Sunday Service');
    await expect(zoomDock).toContainText('Weekly planning');
    await snapshotDock('.youtube-dock', 'youtube-scheduled-list-280.png');
    await snapshotDock('.zoom-dock', 'zoom-scheduled-list-280.png');
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.youtube-dock img, .zoom-dock img')].every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
    const headerGeometry = await page.evaluate(() => {
      const inspect = (selector, title, refresh) => {
        const dock = document.querySelector(selector);
        const header = dock?.querySelector('[data-dock-handle]');
        const rect = (element) => {
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        };
        const images = [...(header?.querySelectorAll('img') ?? [])].map((image) => ({
          alt: image.alt, loaded: image.complete && image.naturalWidth > 0, naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight, rect: rect(image),
        }));
        return {
          panel: rect(dock), header: rect(header), title: header?.querySelector('.stream-dock-header__title-text')?.textContent?.trim(),
          refresh: rect([...header.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === refresh)),
          menu: rect([...header.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === `${title} actions`)),
          images,
        };
      };
      return {
        youtube: inspect('.youtube-dock', 'YouTube Live', 'Refresh streams'),
        zoom: inspect('.zoom-dock', 'Zoom', 'Refresh meetings'),
      };
    });
    measurements.referenceHeaders = headerGeometry;
    for (const [name, geometry] of Object.entries(headerGeometry)) {
      assert.ok(geometry.panel.width >= 278 && geometry.panel.width <= 282, `${name} dock should be approximately 280px wide; got ${geometry.panel.width}.`);
      assert.equal(geometry.header.height, 35, `${name} dock header must be 35px high.`);
      assert.ok(geometry.refresh && geometry.menu, `${name} header must include refresh and overflow actions while connected.`);
      assert.ok(geometry.images.every((image) => image.loaded), `${name} static brand asset did not load.`);
    }
    assert.equal(headerGeometry.youtube.title, 'YouTube Live');
    assert.equal(headerGeometry.zoom.title, 'Zoom');
    const controlsHeaderIcon = await controlsDock.locator('[data-dock-handle]').evaluate((header) => {
      const slot = header.querySelector('span[aria-hidden="true"]');
      const icon = slot?.querySelector('svg.lucide');
      const rect = (element) => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      };
      return { slot: rect(slot), glyph: rect(icon), title: header.querySelector('.stream-dock-header__title-text')?.textContent?.trim() };
    });
    measurements.controlsHeaderIcon = controlsHeaderIcon;
    assert.deepEqual(controlsHeaderIcon.slot, { width: 24, height: 24 }, 'Lucide title icons must use a 24 × 24px slot.');
    assert.deepEqual(controlsHeaderIcon.glyph, { width: 16, height: 16 }, 'Lucide title glyphs must render at 16 × 16px.');
    const youtubeBrand = headerGeometry.youtube.images[0]?.rect;
    assert.deepEqual(youtubeBrand && { width: youtubeBrand.width, height: youtubeBrand.height }, { width: 24, height: 24 }, 'YouTube brand asset must retain its 24 × 24px size.');
    const zoomBrand = await zoomDock.locator('.zoom-brand-icon').evaluate((element) => {
      const image = element.querySelector('img');
      const wrapper = element.getBoundingClientRect();
      const wordmark = image.getBoundingClientRect();
      return { wrapper: { width: wrapper.width, height: wrapper.height }, wordmark: { width: wordmark.width, height: wordmark.height }, loaded: image.complete && image.naturalWidth > 0 };
    });
    measurements.zoomBrandGeometry = zoomBrand;
    assert.deepEqual(zoomBrand.wrapper, { width: 24, height: 24 }, 'Zoom brand slot must remain 24 × 24px.');
    assert.ok(zoomBrand.loaded && Math.abs(zoomBrand.wordmark.width - 18.1339) < 0.1 && Math.abs(zoomBrand.wordmark.height - 4.07512) < 0.1, 'Zoom wordmark asset geometry must match its 18.13 × 4.08px slot.');
    record('Lucide title glyph is 16px inside a 24px frame; both provider brand assets retain their intended sizes', JSON.stringify({ controlsHeaderIcon, youtubeBrand, zoomBrand }));

    const callsBeforeRefresh = await fixture(() => globalThis.__providerDockFixture.calls.filter((call) => call === 'listYouTubeBroadcasts' || call === 'listZoomMeetings'));
    const lateBroadcast = { id: 'fixture-added-later', title: 'Added after refresh', description: '', scheduledStartTime, status: 'ready', privacy: 'unlisted', thumbnailUrl: '' };
    const lateMeeting = { id: 'fixture-meeting-added-later', topic: 'Added after refresh', startTime: scheduledStartTime, durationMinutes: 30, status: 'scheduled' };
    await fixture((_, values) => {
      globalThis.__providerDockFixture.broadcasts.push(values.broadcast);
      globalThis.__providerDockFixture.meetings.push(values.meeting);
    }, { broadcast: lateBroadcast, meeting: lateMeeting });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh meetings', exact: true }).click();
    await expect(youtubeDock).toContainText('Added after refresh');
    await expect(zoomDock).toContainText('Added after refresh');
    const callsAfterRefresh = await fixture(() => globalThis.__providerDockFixture.calls.filter((call) => call === 'listYouTubeBroadcasts' || call === 'listZoomMeetings'));
    assert.ok(callsAfterRefresh.length >= callsBeforeRefresh.length + 2, 'Refresh buttons must pull the provider list again.');
    record('Header refresh pulls newly-added YouTube and Zoom fixture items', `calls before=${callsBeforeRefresh.length}, after=${callsAfterRefresh.length}`);

    await fixture(() => { globalThis.__providerDockFixture.failNextList.youtube = true; });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await expect(youtubeDock).toContainText('Streams could not be refreshed');
    await snapshotDock('.youtube-dock', 'youtube-list-error-280.png');
    await youtubeDock.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(youtubeDock).toContainText('Sunday Service');
    await expect(youtubeDock).not.toContainText('Streams could not be refreshed');
    record('List failure exposes a retry and recovers through the same provider fixture');

    const longBroadcasts = Array.from({ length: 18 }, (_, index) => ({
      id: `fixture-long-broadcast-${index + 1}`,
      title: `Scheduled stream ${String(index + 1).padStart(2, '0')}`,
      description: '', scheduledStartTime, status: 'ready', privacy: 'unlisted', thumbnailUrl: '',
    }));
    const longMeetings = Array.from({ length: 18 }, (_, index) => ({
      id: String(7000000000 + index),
      topic: `Scheduled meeting ${String(index + 1).padStart(2, '0')}`,
      startTime: scheduledStartTime, durationMinutes: 60, status: 'scheduled',
    }));
    await fixture((_, values) => {
      globalThis.__providerDockFixture.broadcasts = values.broadcasts;
      globalThis.__providerDockFixture.meetings = values.meetings;
    }, { broadcasts: longBroadcasts, meetings: longMeetings });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh meetings', exact: true }).click();
    await expect(youtubeDock).toContainText('Scheduled stream 18');
    await expect(zoomDock).toContainText('Scheduled meeting 18');
    const listMetrics = await page.evaluate(() => {
      const youtube = document.querySelector('.youtube-stream-list');
      const zoom = document.querySelector('.zoom-dock-body');
      return {
        youtube: { clientHeight: youtube.clientHeight, scrollHeight: youtube.scrollHeight, scrollWidth: youtube.scrollWidth, clientWidth: youtube.clientWidth },
        zoom: { clientHeight: zoom.clientHeight, scrollHeight: zoom.scrollHeight, scrollWidth: zoom.scrollWidth, clientWidth: zoom.clientWidth },
      };
    });
    measurements.longList = listMetrics;
    assert.ok(listMetrics.youtube.scrollHeight > listMetrics.youtube.clientHeight, 'Long YouTube list should scroll vertically.');
    assert.ok(listMetrics.zoom.scrollHeight > listMetrics.zoom.clientHeight, 'Long Zoom list should scroll vertically.');
    assert.ok(listMetrics.youtube.scrollWidth <= listMetrics.youtube.clientWidth + 1, 'YouTube long list must not overflow horizontally.');
    assert.ok(listMetrics.zoom.scrollWidth <= listMetrics.zoom.clientWidth + 1, 'Zoom long list must not overflow horizontally.');
    const lastBroadcast = page.getByRole('button', { name: 'Select Scheduled stream 18', exact: true });
    await lastBroadcast.focus();
    await page.keyboard.press('Enter');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Scheduled stream 18');
    await youtubeDock.getByRole('button', { name: 'Return', exact: true }).click();
    const lastMeeting = page.getByRole('button', { name: /Scheduled meeting 18/ });
    await lastMeeting.focus();
    await page.keyboard.press('Enter');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText('Scheduled meeting 18');
    await zoomDock.getByRole('button', { name: 'Return', exact: true }).click();
    record('Long provider lists remain keyboard-selectable and vertically scroll without horizontal overflow', JSON.stringify(listMetrics));

    await fixture((_, values) => {
      globalThis.__providerDockFixture.broadcasts = values.broadcasts;
      globalThis.__providerDockFixture.meetings = values.meetings;
    }, { broadcasts: firstBroadcasts, meetings: firstMeetings });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh meetings', exact: true }).click();
    await page.getByRole('button', { name: 'Select Sunday Service', exact: true }).click();
    await page.getByRole('button', { name: /Weekly planning/ }).click();
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Waiting for stream');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Current viewers');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Views');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('—');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText('Waiting for meeting output');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText('1234567890');
    await expect(zoomDock).not.toContainText('Participants');
    await snapshotDock('.youtube-dock', 'youtube-selected-waiting-280.png');
    await snapshotDock('.zoom-dock', 'zoom-selected-waiting-280.png');
    record('Selecting a scheduled YouTube stream and Zoom meeting opens waiting details without invented Zoom participant metrics', 'youtube-selected-waiting-280.png; zoom-selected-waiting-280.png');

    await fixture((_, value) => { globalThis.__providerDockFixture.details['fixture-sunday-service'] = value; }, {
      title: 'Weekly live stream', currentViewers: null, viewCount: null, health: 'excellent', notices: [],
    });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await expect(youtubeDock.getByRole('status', { name: 'Provider health: Excellent' })).toBeVisible();
    await expect(youtubeDock.getByText('YouTube health: Excellent', { exact: true })).toBeVisible();
    await snapshotDock('.youtube-dock', 'youtube-health-excellent-280.png');
    await fixture((_, value) => { globalThis.__providerDockFixture.details['fixture-sunday-service'] = value; }, {
      title: 'Weekly live stream', currentViewers: 0, viewCount: 0, health: 'excellent', notices: [],
    });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await expect(youtubeDock.locator('.youtube-stream-metric__value')).toHaveText(['0', '0']);
    record('Managed YouTube zero viewer and view counts render as authentic zero values');
    await fixture((_, value) => { globalThis.__providerDockFixture.details['fixture-sunday-service'] = value; }, {
      title: 'Weekly live stream', currentViewers: null, viewCount: null, health: 'error', notices: [],
    });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await expect(youtubeDock.getByRole('status', { name: 'Provider health: Error' })).toBeVisible();
    await expect(youtubeDock.getByText('YouTube health: Error', { exact: true })).toBeVisible();
    await snapshotDock('.youtube-dock', 'youtube-health-error-280.png');
    await fixture((_, value) => { globalThis.__providerDockFixture.details['fixture-sunday-service'] = value; }, {
      title: 'Weekly live stream', currentViewers: null, viewCount: null, health: 'waiting', notices: [],
    });
    await page.getByRole('button', { name: 'Refresh streams', exact: true }).click();
    await expect(youtubeDock.getByRole('status', { name: 'Provider health: Waiting for stream' })).toBeVisible();
    await expect(youtubeDock.getByText('YouTube health: Waiting for stream', { exact: true })).toBeVisible();
    record('YouTube stream health matches the reference waiting, excellent, and error states', 'youtube-health-excellent-280.png; youtube-health-error-280.png');

    await fixture(() => {
      globalThis.__providerDockFixture.holdStarts.youtube = true;
      globalThis.__providerDockFixture.holdStarts.zoom = true;
    });
    await controlsDock.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    const cancelYouTube = controlsDock.getByRole('button', { name: 'Cancel YouTube', exact: true });
    const cancelZoom = controlsDock.getByRole('button', { name: 'Cancel Zoom', exact: true });
    await expect(cancelYouTube).toBeVisible();
    await expect(cancelZoom).toBeVisible();
    await snapshotDock('.youtube-dock', 'youtube-connecting-cancel-280.png');
    await snapshotDock('.zoom-dock', 'zoom-connecting-cancel-280.png');
    await page.getByRole('button', { name: 'YouTube Live actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'YouTube settings', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'New stream', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await cancelYouTube.click();
    await expect(controlsDock.getByRole('button', { name: 'Cancel Zoom', exact: true })).toBeVisible();
    await cancelZoom.click();
    await fixture((_, values) => {
      globalThis.__providerDockFixture.releaseStart('youtube', false);
      globalThis.__providerDockFixture.releaseStart('zoom', false);
    }, {});
    await expect(controlsDock.getByRole('button', { name: 'Start Streaming', exact: true })).toBeVisible();
    record('Controls can cancel each provider while connecting; provider selection/settings changes are locked until both settle');

    await resizeWindow(app, page, 1560, 960);
    const actualReferenceWidths = await page.evaluate(() => ({
      youtube: document.querySelector('.youtube-dock').getBoundingClientRect().width,
      zoom: document.querySelector('.zoom-dock').getBoundingClientRect().width,
    }));
    measurements.referenceWidths = actualReferenceWidths;

    const youTubeResizeHandle = page.getByRole('separator', { name: 'Resize YouTube Live dock' });
    const zoomResizeHandle = page.getByRole('separator', { name: 'Resize Controls dock' });
    const youtubeHandleBox = await youTubeResizeHandle.boundingBox();
    const zoomHandleBox = await zoomResizeHandle.boundingBox();
    assert.ok(youtubeHandleBox && zoomHandleBox, 'Provider dock resize handles must be exposed.');
    await page.mouse.move(youtubeHandleBox.x + youtubeHandleBox.width / 2, youtubeHandleBox.y + 40);
    await page.mouse.down();
    await page.mouse.move(youtubeHandleBox.x + youtubeHandleBox.width / 2 + 40, youtubeHandleBox.y + 40);
    await page.mouse.up();
    const zoomHandleAfterFirstResize = await zoomResizeHandle.boundingBox();
    assert.ok(zoomHandleAfterFirstResize, 'Zoom boundary must remain present after resizing YouTube.');
    await page.mouse.move(zoomHandleAfterFirstResize.x + zoomHandleAfterFirstResize.width / 2, zoomHandleAfterFirstResize.y + 40);
    await page.mouse.down();
    await page.mouse.move(zoomHandleAfterFirstResize.x + zoomHandleAfterFirstResize.width / 2 - 40, zoomHandleAfterFirstResize.y + 40);
    await page.mouse.up();
    const resizedWidths = await page.evaluate(() => ({
      youtube: document.querySelector('.youtube-dock').getBoundingClientRect().width,
      zoom: document.querySelector('.zoom-dock').getBoundingClientRect().width,
      controls: document.querySelector('.controls-dock').getBoundingClientRect().width,
    }));
    measurements.resizedWidths = resizedWidths;
    assert.ok(resizedWidths.youtube >= 318 && resizedWidths.youtube <= 322, `YouTube normal dock width should be 320px; got ${resizedWidths.youtube}.`);
    assert.ok(resizedWidths.zoom >= 318 && resizedWidths.zoom <= 322, `Zoom normal dock width should be 320px; got ${resizedWidths.zoom}.`);
    await snapshotDock('.youtube-dock', 'youtube-resized-320.png');
    await snapshotDock('.zoom-dock', 'zoom-resized-320.png');
    record('Resizing both providers from 280px to 320px keeps the full header and content geometry intact', JSON.stringify(resizedWidths));

    await youTubeResizeHandle.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await zoomResizeHandle.focus();
    await page.keyboard.press('Shift+ArrowRight');
    const minimumWidths = await page.evaluate(() => ({
      youtube: document.querySelector('.youtube-dock').getBoundingClientRect().width,
      zoom: document.querySelector('.zoom-dock').getBoundingClientRect().width,
    }));
    measurements.minimumWidths = minimumWidths;
    assert.ok(minimumWidths.youtube >= 240 && minimumWidths.youtube <= 242, `YouTube dock resize should clamp at 240px; got ${minimumWidths.youtube}.`);
    assert.ok(minimumWidths.zoom >= 240 && minimumWidths.zoom <= 242, `Zoom dock resize should clamp at 240px; got ${minimumWidths.zoom}.`);
    await snapshotDock('.youtube-dock', 'youtube-minimum-240.png');
    await snapshotDock('.zoom-dock', 'zoom-minimum-240.png');

    await resizeWindow(app, page, 1100, 760);
    const narrowMetrics = await page.evaluate(() => {
      const measure = (selector) => {
        const dock = document.querySelector(selector);
        const body = dock.querySelector(selector === '.youtube-dock' ? '.youtube-dock-body' : '.zoom-dock-body');
        const dockRect = dock.getBoundingClientRect(), bodyRect = body.getBoundingClientRect();
        return {
          width: dockRect.width, clientWidth: dock.clientWidth, scrollWidth: dock.scrollWidth,
          bodyClientWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
          bodyWithinPanel: bodyRect.left >= dockRect.left && bodyRect.right <= dockRect.right + 1,
        };
      };
      return { viewport: { width: innerWidth, height: innerHeight }, youtube: measure('.youtube-dock'), zoom: measure('.zoom-dock') };
    });
    measurements.narrowViewport = narrowMetrics;
    assert.ok(narrowMetrics.youtube.width >= 240 && narrowMetrics.zoom.width >= 240, 'Provider docks must respect their 240px minimum at a narrow viewport.');
    assert.ok(narrowMetrics.youtube.bodyScrollWidth <= narrowMetrics.youtube.bodyClientWidth + 1, 'YouTube body must not overflow horizontally at a narrow viewport.');
    assert.ok(narrowMetrics.zoom.bodyScrollWidth <= narrowMetrics.zoom.bodyClientWidth + 1, 'Zoom body must not overflow horizontally at a narrow viewport.');
    assert.ok(narrowMetrics.youtube.bodyWithinPanel && narrowMetrics.zoom.bodyWithinPanel, 'Narrow provider bodies must remain inside their panels.');
    await snapshotDock('.youtube-dock', 'youtube-narrow-1100.png');
    await snapshotDock('.zoom-dock', 'zoom-narrow-1100.png');
    record('At the 1100px minimum app width, provider docks respect minimum widths and keep content within their panels', JSON.stringify(narrowMetrics));
    await resizeWindow(app, page, 1560, 960);
    const restoreYouTubeHandle = await youTubeResizeHandle.boundingBox();
    assert.ok(restoreYouTubeHandle, 'YouTube resize handle must remain available after restoring the viewport.');
    await page.mouse.move(restoreYouTubeHandle.x + restoreYouTubeHandle.width / 2, restoreYouTubeHandle.y + 40);
    await page.mouse.down();
    await page.mouse.move(restoreYouTubeHandle.x + restoreYouTubeHandle.width / 2 + 80, restoreYouTubeHandle.y + 40);
    await page.mouse.up();
    const restoreZoomHandle = await zoomResizeHandle.boundingBox();
    assert.ok(restoreZoomHandle, 'Controls resize handle must remain available after restoring YouTube width.');
    await page.mouse.move(restoreZoomHandle.x + restoreZoomHandle.width / 2, restoreZoomHandle.y + 40);
    await page.mouse.down();
    await page.mouse.move(restoreZoomHandle.x + restoreZoomHandle.width / 2 - 80, restoreZoomHandle.y + 40);
    await page.mouse.up();
    const restoredDockWidths = await page.evaluate(() => ({
      youtube: document.querySelector('.youtube-dock').getBoundingClientRect().width,
      zoom: document.querySelector('.zoom-dock').getBoundingClientRect().width,
    }));
    measurements.restoredDockWidths = restoredDockWidths;
    assert.ok(restoredDockWidths.youtube >= 318 && restoredDockWidths.youtube <= 322, `YouTube live-state screenshots should return to 320px; got ${restoredDockWidths.youtube}.`);
    assert.ok(restoredDockWidths.zoom >= 318 && restoredDockWidths.zoom <= 322, `Zoom live-state screenshots should return to 320px; got ${restoredDockWidths.zoom}.`);
    record('After narrow-window inspection, provider docks return to 320px for live and error-state review', JSON.stringify(restoredDockWidths));
    measurements.rendererCapabilities = await page.evaluate(() => ({
      videoFrame: typeof globalThis.VideoFrame,
      audioWorklet: typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype,
      webCodecsVideoEncoder: typeof globalThis.VideoEncoder,
    }));

    const selectedStartCallsBefore = await fixture(() => globalThis.__providerDockFixture.calls.filter((call) => call === 'startYouTubeStreaming' || call === 'startZoomStreaming').length);
    await controlsDock.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Weekly live stream');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText('Joining meeting');
    await snapshotDock('.zoom-dock', 'zoom-joining-320.png');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText('Starting output');
    await snapshotDock('.zoom-dock', 'zoom-starting-output-320.png');
    await expect(controlsDock).toContainText('Live · YouTube');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText(/Live · \d{2}:\d{2}/);
    await expect(youtubeDock.getByRole('status', { name: 'Output status: Streaming' })).toBeVisible();
    await expect(youtubeDock.getByText('YouTube health: Waiting for stream', { exact: true })).toBeVisible();
    await expect.poll(() => fixture(() => {
      const media = globalThis.__providerDockFixture.zoomMediaStats;
      return { video: media.videoCount > 0, audio: media.audioCount > 0 };
    })).toEqual({ video: true, audio: true });
    const zoomMediaMessages = await fixture(() => ({
      settings: globalThis.__providerDockFixture.zoomSettings,
      ...globalThis.__providerDockFixture.zoomMediaStats,
    }));
    const expectedVideoBytes = zoomMediaMessages.settings.width * zoomMediaMessages.settings.height * 3 / 2;
    assert.deepEqual({ width: zoomMediaMessages.settings.width, height: zoomMediaMessages.settings.height }, { width: 1920, height: 1080 }, 'The Zoom media fixture should exercise the normal 1080p output size.');
    assert.ok(zoomMediaMessages.videoCount > 0, 'The live Zoom output must deliver a video frame to the synthetic main-process receiver.');
    assert.equal(zoomMediaMessages.videoSample.width, zoomMediaMessages.settings.width);
    assert.equal(zoomMediaMessages.videoSample.height, zoomMediaMessages.settings.height);
    assert.equal(zoomMediaMessages.videoSample.dataBytes, expectedVideoBytes, 'Zoom I420 video frames must match the selected dimensions and packed buffer length.');
    assert.ok(zoomMediaMessages.audioCount > 0, 'The live Zoom output must deliver PCM audio to the synthetic main-process receiver.');
    assert.deepEqual({ dataBytes: zoomMediaMessages.audioSample.dataBytes, sampleRate: zoomMediaMessages.audioSample.sampleRate, channels: zoomMediaMessages.audioSample.channels }, { dataBytes: 3840, sampleRate: 48000, channels: 2 }, 'Zoom audio messages must contain stereo 48 kHz 20 ms PCM packets.');
    const videoCountBeforeBurst = zoomMediaMessages.videoCount;
    await page.waitForTimeout(1000);
    const videoCountAfterBurst = await fixture(() => globalThis.__providerDockFixture.zoomMediaStats.videoCount);
    assert.ok(videoCountAfterBurst > videoCountBeforeBurst, 'Zoom video frames should continue arriving during a bounded 1 second live interval.');
    measurements.zoomSustainedVideo = { width: zoomMediaMessages.settings.width, height: zoomMediaMessages.settings.height, observedFrameCountDuringBurst: videoCountAfterBurst - videoCountBeforeBurst, intervalMs: 1000 };
    measurements.zoomMediaMessages = { settings: zoomMediaMessages.settings, videoCount: videoCountAfterBurst, videoSample: zoomMediaMessages.videoSample, audioCount: zoomMediaMessages.audioCount, audioSample: zoomMediaMessages.audioSample };
    record('The native Zoom renderer sends packed I420 1080p frames and stereo PCM through the Electron 44 port path', JSON.stringify({ videoSample: zoomMediaMessages.videoSample, audioSample: zoomMediaMessages.audioSample, sustained: measurements.zoomSustainedVideo }));
    const selectedStartCallsAfter = await fixture(() => globalThis.__providerDockFixture.calls.filter((call) => call === 'startYouTubeStreaming' || call === 'startZoomStreaming').length);
    assert.equal(selectedStartCallsAfter, selectedStartCallsBefore + 2, 'The central start action must start both selected providers through their fixture IPC calls.');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Current viewers');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Views');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('—');
    await expect(zoomDock).not.toContainText('Participants');
    await expect(controlsDock.getByRole('button', { name: 'Stop YouTube', exact: true })).toBeVisible();
    await expect(controlsDock.getByRole('button', { name: 'Stop Zoom', exact: true })).toBeVisible();
    await expect(youtubeDock.getByRole('button', { name: 'Return', exact: true })).toHaveCount(0);
    await expect(zoomDock.getByRole('button', { name: 'Return', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'YouTube Live actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'YouTube settings', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'New stream', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Zoom actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'New meeting', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const lockedZoomSettings = page.getByRole('dialog', { name: 'Zoom settings' });
    await expect(lockedZoomSettings.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
    await lockedZoomSettings.getByRole('button', { name: 'Done', exact: true }).click();
    await snapshotDock('.youtube-dock', 'youtube-live-320.png');
    await snapshotDock('.zoom-dock', 'zoom-live-320.png');
    record('Both selected destinations start from Controls; Zoom phases and elapsed time render without fabricated participant counts', 'youtube-live-320.png; zoom-joining-320.png; zoom-starting-output-320.png; zoom-live-320.png');
    record('While connecting/live, selection returns are unavailable and settings changes are locked; per-output Stop remains available');

    await controlsDock.getByRole('button', { name: 'Stop YouTube', exact: true }).click();
    await expect(controlsDock).not.toContainText('Live · YouTube');
    await expect(controlsDock.getByRole('button', { name: 'Stop Zoom', exact: true })).toBeVisible();
    await controlsDock.getByRole('button', { name: 'Stop Zoom', exact: true }).click();
    await expect(controlsDock.getByRole('button', { name: 'Start Streaming', exact: true })).toBeVisible();
    await expect(youtubeDock.getByRole('button', { name: 'Return', exact: true })).toBeVisible();
    await expect(zoomDock.getByRole('button', { name: 'Return', exact: true })).toBeVisible();
    record('Stopping one output leaves the other live; stopping the remaining output restores Return actions');

    await fixture(() => { globalThis.__providerDockFixture.failNextStart.youtube = 'Synthetic stream start failure.'; });
    await controlsDock.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(youtubeDock).toContainText('YouTube streaming failed.');
    await expect(controlsDock).toContainText('YouTube output could not start');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText('Joining meeting');
    await snapshotDock('.youtube-dock', 'youtube-start-error-320.png');
    await controlsDock.getByRole('button', { name: 'Stop Zoom', exact: true }).click();
    await expect(controlsDock.getByRole('button', { name: 'Start Streaming', exact: true })).toBeVisible();
    await expect(youtubeDock.getByRole('button', { name: 'Return', exact: true })).toBeVisible();
    await snapshotDock('.youtube-dock', 'youtube-start-error-return-320.png');
    await zoomDock.getByRole('button', { name: 'Return', exact: true }).click();
    await controlsDock.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(controlsDock).toContainText('Live · YouTube');
    await expect(youtubeDock.getByRole('region', { name: 'Current stream details' })).toContainText('Weekly live stream');
    await snapshotDock('.youtube-dock', 'youtube-recovered-320.png');
    record('A failed YouTube output leaves a safe Return action; Controls retries the selected destination successfully');
    await controlsDock.getByRole('button', { name: 'Stop YouTube', exact: true }).click();
    await expect(controlsDock.getByRole('button', { name: 'Start Streaming', exact: true })).toBeVisible();

    await zoomDock.getByRole('button', { name: /Weekly planning/ }).click();
    await fixture(() => { globalThis.__providerDockFixture.failNextStart.zoom = 'Synthetic Zoom start failure.'; });
    await controlsDock.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(controlsDock).toContainText('Live · YouTube');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText('Error');
    await expect(controlsDock.getByRole('button', { name: 'Stop YouTube', exact: true })).toBeVisible();
    await expect(zoomDock.getByRole('button', { name: 'Return', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Zoom actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const liveZoomSettings = page.getByRole('dialog', { name: 'Zoom settings' });
    await expect(liveZoomSettings.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
    await liveZoomSettings.getByRole('button', { name: 'Done', exact: true }).click();
    await page.keyboard.press('Escape');
    record('A failed Zoom start leaves YouTube live and keeps Zoom selection locked while another destination is active');

    await controlsDock.getByRole('button', { name: 'Stop YouTube', exact: true }).click();
    await expect(zoomDock.getByRole('button', { name: 'Return', exact: true })).toBeVisible();
    await snapshotDock('.zoom-dock', 'zoom-start-error-return-320.png');
    await zoomDock.getByRole('button', { name: 'Return', exact: true }).click();
    await zoomDock.getByRole('button', { name: /Weekly planning/ }).click();
    await controlsDock.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(controlsDock).toContainText('Live · YouTube');
    await expect(zoomDock.getByRole('region', { name: 'Selected Zoom meeting' })).toContainText(/Live · \d{2}:\d{2}/);
    await snapshotDock('.zoom-dock', 'zoom-recovered-320.png');
    record('Zoom Return is available after all outputs stop; choosing the meeting again and starting from Controls recovers cleanly');
    await controlsDock.getByRole('button', { name: 'Stop YouTube', exact: true }).click();
    await controlsDock.getByRole('button', { name: 'Stop Zoom', exact: true }).click();
    await expect(controlsDock.getByRole('button', { name: 'Start Streaming', exact: true })).toBeVisible();

    await youtubeDock.getByRole('button', { name: 'Return', exact: true }).click();
    await zoomDock.getByRole('button', { name: 'Return', exact: true }).click();
    await fixture(() => { globalThis.__providerDockFixture.holdNdiStart = true; });
    await controlsDock.getByRole('button', { name: 'NDI output', exact: true }).click();
    const ndiDialog = page.getByRole('dialog', { name: 'NDI Program output' });
    await expect(ndiDialog).toBeVisible();
    await ndiDialog.getByRole('button', { name: 'Start NDI output', exact: true }).click();
    await expect(controlsDock.locator('button.control-action').filter({ hasText: 'NDI output · Starting' })).toBeVisible();
    await expect(ndiDialog.getByRole('status')).toHaveText('Starting NDI…');
    await fixture(() => globalThis.__providerDockFixture.releaseNdiStart());
    await expect(controlsDock.locator('button.control-action').filter({ hasText: 'NDI output · Active' })).toBeVisible();
    await expect.poll(() => fixture(() => globalThis.__providerDockFixture.ndiSendStats.video)).toBeGreaterThan(0);
    await fixture(() => { globalThis.__providerDockFixture.holdNdiStop = true; });
    await ndiDialog.getByRole('button', { name: 'Stop NDI output', exact: true }).click();
    await expect(controlsDock.locator('button.control-action').filter({ hasText: 'NDI output · Stopping' })).toBeVisible();
    await expect(ndiDialog.getByRole('status')).toHaveText('Stopping NDI…');
    await fixture(() => globalThis.__providerDockFixture.releaseNdiStop());
    await expect(controlsDock.locator('button.control-action').filter({ hasText: 'NDI output' })).toBeVisible();
    await expect(ndiDialog.getByRole('status')).toHaveText('NDI output stopped');
    measurements.ndiSyntheticSend = await fixture(() => ({ ...globalThis.__providerDockFixture.ndiSendStats }));
    record('NDI Controls reflects Starting, Active and Stopping alongside the output dialog; fixture media stays local', JSON.stringify(measurements.ndiSyntheticSend));
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'YouTube Live actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'YouTube settings', exact: true }).click();
    const disconnectYouTubeSettings = page.getByRole('dialog', { name: 'YouTube settings' });
    await disconnectYouTubeSettings.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(disconnectYouTubeSettings.getByRole('button', { name: 'Connect YouTube', exact: true })).toBeVisible();
    await disconnectYouTubeSettings.locator('input[autocomplete="off"]').fill('fixture-only-manual-key');
    await disconnectYouTubeSettings.getByRole('button', { name: 'Done', exact: true }).click();
    const manualDetails = youtubeDock.getByRole('region', { name: 'Current stream details' });
    await expect(manualDetails).toContainText('Viewer counts require a connected YouTube account and a selected stream.');
    await expect(manualDetails.getByRole('status', { name: 'Output status: Waiting for stream' })).toBeVisible();
    await expect(manualDetails.getByRole('status', { name: /Provider health:/ })).toHaveCount(0);
    await expect(manualDetails.locator('.youtube-stream-metric__value')).toHaveText(['—', '—']);
    await fixture(() => { globalThis.__providerDockFixture.holdManualStart = true; });
    await controlsDock.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    const manualSettings = page.getByRole('dialog', { name: 'Stream settings' });
    await expect(manualSettings).toBeVisible();
    await manualSettings.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(controlsDock.locator('.control-output-state').filter({ hasText: 'Connecting · YouTube' })).toBeVisible();
    await expect(manualDetails.getByRole('status', { name: 'Output status: Connecting' })).toBeVisible();
    await snapshotDock('.youtube-dock', 'youtube-manual-connecting-320.png');
    await fixture(() => globalThis.__providerDockFixture.releaseManualStart());
    await expect(controlsDock).toContainText('Live · YouTube');
    await expect(manualDetails.getByRole('status', { name: 'Output status: Streaming' })).toBeVisible();
    await expect(manualDetails.getByText('Streaming', { exact: true })).toBeVisible();
    await expect(manualDetails.getByRole('status', { name: /Provider health:/ })).toHaveCount(0);
    await expect(manualDetails.locator('.youtube-stream-metric__value')).toHaveText(['—', '—']);
    await expect.poll(() => fixture(() => globalThis.__providerDockFixture.manualWriteCount)).toBeGreaterThan(0);
    await snapshotDock('.youtube-dock', 'youtube-manual-streaming-320.png');
    await controlsDock.getByRole('button', { name: 'Stop YouTube', exact: true }).click();
    await expect(controlsDock.getByRole('button', { name: 'Start Streaming', exact: true })).toBeVisible();
    await expect(manualDetails.getByRole('status', { name: 'Output status: Waiting for stream' })).toBeVisible();
    measurements.manualOutput = await fixture(() => ({
      startCount: globalThis.__providerDockFixture.manualStartCount,
      outputIds: [...globalThis.__providerDockFixture.manualStartOutputIds],
      acceptedSyntheticChunks: globalThis.__providerDockFixture.manualWriteCount,
      stopCount: globalThis.__providerDockFixture.manualStopCount,
    }));
    assert.deepEqual(measurements.manualOutput.outputIds, ['youtube'], 'Manual YouTube must use the YouTube output ID without calling the managed broadcast API.');
    assert.ok(measurements.manualOutput.acceptedSyntheticChunks > 0, 'The isolated renderer should send media chunks to the synthetic IPC handler.');
    assert.equal(measurements.manualOutput.stopCount, 1, 'Stopping manual YouTube must stop the synthetic generic output session.');
    record('Manual YouTube moves Waiting → Connecting → green Streaming → Waiting; unknown provider metrics remain unknown', JSON.stringify(measurements.manualOutput));

    assert.deepEqual(rendererErrors, [], 'Provider dock flows should not emit renderer errors.');
    const summary = {
      passed: true,
      electronVersion,
      runRoot: path.relative(root, runRoot),
      inspectedRevision: { head: await currentHeadRevision(), interfaceFingerprint: await interfaceFingerprint(), rendererAssets: await currentRendererAssets(), dirtyWorkspace: true },
      reference: { fileKey: 'BvW7xtWU1utUzgXbtDIMHV', sessionId: 'f68ea89c-0d11-45f7-8f8b-b792d9a08108', screenshot: 'output/playwright/provider-docks-figma/section.png', youtubeNodes: ['57:5887', '57:5948', '57:5991', '57:6034', '57:6077', '57:6151', '57:6199', '77:2959'], zoomNodes: ['35:7162', '35:7229', '241:11200', '35:7304'] },
      checks,
      measurements,
      screenshots,
      rendererErrors,
      note: 'All provider API and output IPC calls were handled by a synthetic main-process fixture; OAuth, provider APIs, broadcast services, and external network were not used.',
    };
    await fs.writeFile(path.join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const failure = {
      passed: false,
      error: String(error),
      inspectedRevision: { head: await currentHeadRevision(), interfaceFingerprint: await interfaceFingerprint(), rendererAssets: await currentRendererAssets(), dirtyWorkspace: true },
      reference: { fileKey: 'BvW7xtWU1utUzgXbtDIMHV', sessionId: 'f68ea89c-0d11-45f7-8f8b-b792d9a08108' },
      checks, measurements, screenshots, rendererErrors,
    };
    if (page) {
      failure.body = await page.locator('body').innerText().catch(() => '');
      failure.zoomFixture = await fixture(() => ({
        calls: globalThis.__providerDockFixture.calls.filter((call) => /Zoom/.test(call)),
        debug: globalThis.__providerDockFixture.debug,
        messageProbe: globalThis.__providerDockFixture.messageProbe,
        mediaStats: globalThis.__providerDockFixture.zoomMediaStats,
        openPorts: [...globalThis.__providerDockFixture.zoomPorts.keys()],
      })).catch((fixtureError) => ({ fixtureReadError: String(fixtureError) }));
      const failurePath = path.join(runRoot, 'failure.png');
      await page.screenshot({ path: failurePath }).catch(() => undefined);
      screenshots.push(path.relative(root, failurePath));
    }
    await fs.writeFile(path.join(runRoot, 'failure.json'), JSON.stringify(failure, null, 2));
    console.error(JSON.stringify({ runRoot: path.relative(root, runRoot), ...failure }, null, 2));
    throw error;
  } finally {
    await closeApp(app);
  }
}

async function resizeWindow(app, page, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) throw new Error('The LumaStream window is unavailable.');
    window.setSize(size.width, size.height);
  }, { width, height });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(width - 20);
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(width + 5);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

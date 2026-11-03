import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
process.chdir(root);
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const streamRequire = createRequire(path.join(root, 'apps/stream/package.json'));
const electronPath = streamRequire('electron');
const electronVersion = JSON.parse(fsSync.readFileSync(streamRequire.resolve('electron/package.json'), 'utf8')).version;

const TARGET_TITLE = 'LumaStream Capture Restore Fixture';
const TARGET_COLOR = { r: 28, g: 166, b: 113 };
const PREVIEW_COLOR = { r: 99, g: 66, b: 171 };
const SOURCE_NAME = 'Capture Restore Fixture Window';
const BINARY = path.resolve('apps/stream/out/main/index.js');

function uuid() { return crypto.randomUUID(); }

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function uniquePorts(count) {
  const ports = new Set();
  while (ports.size < count) ports.add(await freePort());
  return [...ports];
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function closeElectron(app) {
  if (!app) return;
  let child;
  try { child = app.process(); } catch { return; }
  let closed = false;
  try {
    await Promise.race([
      app.close().then(() => { closed = true; }),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
  } catch { /* The process may already have exited after a renderer failure. */ }
  if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await waitForExit(child, 3000);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function launchApp(args, port, env = process.env) {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.ELECTRON_RENDERER_URL;
  return electron.launch({
    executablePath: electronPath,
    args: [`--remote-debugging-port=${port}`, ...args],
    env: childEnv,
    timeout: 30000,
  });
}

function streamBootstrap(appDataPath, tracePath) {
  return `
    const fs = require('node:fs');
    const { app, BrowserWindow, ipcMain, screen, session, systemPreferences } = require('electron');
    app.setPath('appData', ${JSON.stringify(appDataPath)});
    const tracePath = ${JSON.stringify(tracePath)};
    const trace = (entry) => fs.appendFileSync(tracePath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\\n');
    app.on('browser-window-created', (_event, window) => {
      const workArea = screen.getPrimaryDisplay().workArea;
      const width = Math.max(360, workArea.width - 820);
      const height = Math.max(520, Math.min(820, workArea.height));
      trace({ kind: 'fixture-layout', workArea, streamBounds: { x: workArea.x + 820, y: workArea.y, width, height } });
      setTimeout(() => {
        window.setMinimumSize(320, 300);
        window.setBounds({ x: workArea.x + 820, y: workArea.y, width, height });
      }, 0);
    });
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
      const captureCall = channel === 'stream:resolve-desktop-capture' || channel === 'stream:prepare-desktop-capture';
      if (captureCall) trace({ kind: 'ipc-request', channel, args });
      try {
        const result = await listener(event, ...args);
        if (captureCall) trace({ kind: 'ipc-result', channel, result });
        return result;
      } catch (error) {
        if (captureCall) trace({ kind: 'ipc-error', channel, error: String(error) });
        throw error;
      }
    });
    app.whenReady().then(() => {
      try { trace({ kind: 'system-access', screen: systemPreferences.getMediaAccessStatus('screen') }); } catch (error) { trace({ kind: 'system-access-error', error: String(error) }); }
      const defaultSession = session.defaultSession;
      const originalPermissionRequest = defaultSession.setPermissionRequestHandler.bind(defaultSession);
      defaultSession.setPermissionRequestHandler = (handler) => originalPermissionRequest((webContents, permission, callback, details) => {
        const mediaTypes = details && 'mediaTypes' in details ? details.mediaTypes : undefined;
        const requested = permission === 'media' || String(permission) === 'display-capture';
        if (requested) trace({ kind: 'permission-request', permission, mediaTypes, webContentsId: webContents.id });
        return handler(webContents, permission, (allowed) => {
          if (requested) trace({ kind: 'permission-result', permission, mediaTypes, allowed, webContentsId: webContents.id });
          callback(allowed);
        }, details);
      });
      const originalDisplayMediaHandler = defaultSession.setDisplayMediaRequestHandler.bind(defaultSession);
      defaultSession.setDisplayMediaRequestHandler = (handler) => originalDisplayMediaHandler((request, callback) => {
        trace({
          kind: 'display-media-request',
          userGesture: request.userGesture,
          videoRequested: request.videoRequested,
          audioRequested: request.audioRequested,
          frameUrl: request.frame && request.frame.url,
        });
        return handler(request, (streams) => {
          trace({
            kind: 'display-media-result',
            sourceId: streams.video && streams.video.id,
            sourceName: streams.video && streams.video.name,
            hasAudio: Boolean(streams.audio),
          });
          callback(streams);
        });
      });
    });
    require(${JSON.stringify(BINARY)});
  `;
}

async function writeBootstrap(file, body) {
  await fs.writeFile(file, body, 'utf8');
}

function fixtureProject(targetOption) {
  const liveSceneId = uuid();
  const previewSceneId = uuid();
  const captureSourceId = uuid();
  const captureBindingId = uuid();
  const previewColorId = uuid();
  const output = {
    baseWidth: 1280,
    baseHeight: 720,
    width: 1280,
    height: 720,
    frameRate: 30,
    streamVideoBitrateKbps: 6000,
    streamAudioBitrateKbps: 160,
    streamAudioTrack: 1,
    streamRateControl: 'cbr',
    streamVideoEncoder: 'h264_videotoolbox',
    streamEncoderQuality: 60,
    streamHardwareEncoding: false,
    streamKeyframeIntervalSeconds: 2,
    recordingVideoBitrateKbps: 8000,
    recordingAudioBitrateKbps: 160,
    recordingAudioTracks: [1],
    recordingContainer: 'webm',
    recordingRateControl: 'cbr',
    recordingVideoEncoder: 'h264_videotoolbox',
    recordingEncoderQuality: 60,
    recordingHardwareEncoding: false,
    recordingKeyframeIntervalSeconds: 2,
  };
  return {
    project: {
      version: 1,
      output,
      studioMode: true,
      activeSceneId: previewSceneId,
      liveSceneId,
      hotkeys: { toggleStreaming: 'Control+Alt+F9', toggleRecording: 'Control+Alt+F10', toggleReplayBuffer: 'Control+Alt+F11', saveReplay: 'Control+Alt+F12' },
      sceneSwitchHotkeys: {},
      sourceVisibilityHotkeys: {},
      scenes: [
        {
          id: liveSceneId,
          name: 'Program Fixture',
          sources: [{
            id: captureSourceId,
            name: SOURCE_NAME,
            kind: 'window',
            visible: true,
            muted: true,
            volume: 0,
            transform: { x: 0, y: 0, width: output.width, height: output.height, rotation: 0 },
            captureId: targetOption.id,
            captureBindingId,
            captureTarget: {
              kind: 'window',
              name: targetOption.name.slice(0, 512),
              ...(targetOption.appIconHash ? { appIconHash: targetOption.appIconHash } : {}),
            },
            cursorMode: 'never',
            captureAudioEnabled: false,
          }],
        },
        {
          id: previewSceneId,
          name: 'Staged Preview Fixture',
          sources: [{
            id: previewColorId,
            name: 'Unrelated staged color metadata',
            kind: 'color',
            visible: true,
            muted: true,
            volume: 0,
            color: '#6342ab',
            transform: { x: 0, y: 0, width: output.width, height: output.height, rotation: 0 },
          }],
        },
      ],
    },
    ids: { liveSceneId, previewSceneId, captureSourceId, captureBindingId, previewColorId },
  };
}

async function seedStreamProject(appDataPath, targetOption) {
  const dataDirectory = path.join(appDataPath, 'LumaStream');
  const collectionId = uuid();
  const fixture = fixtureProject(targetOption);
  const collectionsDirectory = path.join(dataDirectory, 'scene-collections');
  await fs.mkdir(collectionsDirectory, { recursive: true });
  await fs.writeFile(path.join(collectionsDirectory, 'index.json'), JSON.stringify({
    version: 1,
    activeCollectionId: collectionId,
    collections: [{ id: collectionId, name: 'Capture Restore E2E' }],
  }, null, 2));
  await fs.writeFile(path.join(collectionsDirectory, `${collectionId}.json`), JSON.stringify(fixture.project, null, 2));
  return { ...fixture, collectionId, dataDirectory };
}

async function readTargetOption(probeRoot, targetTitle, probePort) {
  const outputPath = path.join(probeRoot, 'target-source.json');
  const bootstrap = path.join(probeRoot, 'enumerate-target.cjs');
  await writeBootstrap(bootstrap, `
    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const { app, desktopCapturer, systemPreferences } = require('electron');
    app.setPath('userData', ${JSON.stringify(path.join(probeRoot, 'enumerator-data'))});
    app.whenReady().then(async () => {
      try {
        let sources = [];
        let matches = [];
        const enumerationCounts = [];
        for (let attempt = 0; attempt < 12 && matches.length === 0; attempt += 1) {
          sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
          matches = sources.filter((source) => source.name.includes(${JSON.stringify(targetTitle)}));
          enumerationCounts.push({ total: sources.length, fixtureMatches: matches.length });
          if (matches.length === 0) await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const options = matches.map((source) => {
          const icon = source.appIcon;
          const appIconHash = icon && !icon.isEmpty() ? crypto.createHash('sha256').update(icon.toPNG()).digest('hex') : undefined;
          return { id: source.id, name: source.name, kind: 'window', displayId: source.display_id || undefined, appIconHash };
        });
        const result = { sources: options, enumerationCounts, screenAccessStatus: systemPreferences.getMediaAccessStatus('screen') };
        fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(result, null, 2));
      } catch (error) {
        fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ error: String(error), stack: error && error.stack }));
      } finally { app.quit(); }
    });
  `);
  const probe = await launchApp([bootstrap], probePort);
  const child = probe.process();
  try {
    await waitForExit(child, 15000);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  } finally {
    await closeElectron(probe);
  }
  const result = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  if (result?.error) throw new Error(`Electron 44 target enumeration failed: ${result.error}`);
  if (!Array.isArray(result?.sources)) throw new Error(`Target enumeration returned unexpected output: ${JSON.stringify(result)}`);
  if (result.sources.length !== 1) throw new Error(`Expected exactly the fixture target window; found ${result.sources.length}: ${JSON.stringify(result)}`);
  return { option: result.sources[0], screenAccessStatus: result.screenAccessStatus, enumerationCounts: result.enumerationCounts };
}

async function inspectPage(page) {
  return page.evaluate((expectedSourceName) => {
    const readCanvas = (selector) => {
      const canvas = document.querySelector(selector);
      if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) return null;
      try {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return null;
        const x = Math.max(0, Math.floor(canvas.width * 0.12));
        const y = Math.max(0, Math.floor(canvas.height * 0.16));
        const data = context.getImageData(x, y, 1, 1).data;
        return { width: canvas.width, height: canvas.height, pixel: Array.from(data).slice(0, 3) };
      } catch (error) { return { error: String(error) }; }
    };
    const programPanel = document.querySelector('.program-panel');
    const videos = Array.from(document.querySelectorAll('video')).map((video) => {
      const stream = video.srcObject;
      const tracks = stream instanceof MediaStream ? stream.getVideoTracks().map((track) => ({
        label: track.label, readyState: track.readyState, muted: track.muted, settings: track.getSettings(),
      })) : [];
      let samplePixel = null;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        try {
          const frame = document.createElement('canvas');
          frame.width = video.videoWidth;
          frame.height = video.videoHeight;
          const context = frame.getContext('2d', { willReadFrequently: true });
          context.drawImage(video, 0, 0);
          samplePixel = Array.from(context.getImageData(Math.floor(frame.width * 0.12), Math.floor(frame.height * 0.16), 1, 1).data).slice(0, 3);
        } catch (error) { samplePixel = String(error); }
      }
      return { readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, currentTime: video.currentTime, paused: video.paused, samplePixel, tracks };
    });
    const programVideoTracks = videos.flatMap((video) => video.tracks);
    const sourceRows = Array.from(document.querySelectorAll('.source-row'))
      .filter((row) => row.textContent?.includes(expectedSourceName))
      .map((row) => ({ text: row.textContent?.trim(), status: row.querySelector('.source-availability')?.getAttribute('aria-label') ?? null }));
    const stageNames = Array.from(document.querySelectorAll('.stage-panel .stage-label b')).map((item) => item.textContent?.trim() ?? '');
    return {
      title: document.title,
      studioMode: document.querySelector('.monitor-stage')?.classList.contains('studio') ?? false,
      stageNames,
      programPixel: readCanvas('.program-panel canvas'),
      previewPixel: readCanvas('.stage-panel:not(.program-panel) canvas'),
      liveVideoTracks: programVideoTracks.filter((track) => track.readyState === 'live' && !track.muted),
      videos,
      sourceRows,
      visibleText: document.body.innerText.slice(0, 12000),
    };
  }, SOURCE_NAME);
}

function nearColor(pixelInfo, expected, tolerance = 12) {
  if (!pixelInfo?.pixel) return false;
  return pixelInfo.pixel.every((channel, index) => Math.abs(channel - [expected.r, expected.g, expected.b][index]) <= tolerance);
}

async function waitForState(page, predicate, phase, timeoutMs = 30000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await inspectPage(page).catch((error) => ({ error: String(error) }));
    if (predicate(last)) return last;
    await page.waitForTimeout(300);
  }
  throw new Error(`${phase}: timed out waiting for capture; last observation: ${JSON.stringify(last)}`);
}

async function readPersistedProject(page) {
  return page.evaluate(async () => {
    const workspace = await window.streamApi.loadProject();
    return {
      activeSceneId: workspace.project.activeSceneId,
      liveSceneId: workspace.project.liveSceneId,
      studioMode: workspace.project.studioMode,
      captureSource: workspace.project.scenes.flatMap((scene) => scene.sources).find((source) => source.kind === 'window'),
      previewSource: workspace.project.scenes.flatMap((scene) => scene.sources).find((source) => source.name === 'Unrelated staged color metadata'),
    };
  });
}

async function assertNoWarningRow(page) {
  await page.locator('button.scene-row[aria-label="Program Fixture"]').evaluate((button) => button.click());
  const row = page.getByRole('treeitem', { name: new RegExp(SOURCE_NAME) });
  await row.waitFor({ state: 'visible', timeout: 10000 });
  const warningCount = await row.locator('.source-availability').count();
  if (warningCount !== 0) {
    const label = await row.locator('.source-availability').first().getAttribute('aria-label');
    throw new Error(`Restored source still shows a status icon: ${label}`);
  }
  return { sourceRowText: (await row.innerText()).trim(), statusIndicatorCount: warningCount };
}

async function returnToPreview(page) {
  await page.locator('button.scene-row[aria-label="Staged Preview Fixture"]').evaluate((button) => button.click());
  await page.getByRole('button', { name: 'Staged Preview Fixture', exact: true }).waitFor({ state: 'visible' });
  await page.waitForTimeout(450);
}

async function probeManualDisplayCapture(page, expectedTarget) {
  const prepared = await page.evaluate(async ({ id, kind, name, target }) => {
    const workspace = await window.streamApi.loadProject();
    const source = workspace.project.scenes.flatMap((scene) => scene.sources)
      .find((candidate) => candidate.kind === kind && candidate.name === name);
    if (!source) throw new Error('The fixture capture source was not loaded in the Stream project.');
    const option = await window.streamApi.resolveDesktopCapture(kind === 'display' ? 'screen' : 'window', id, target);
    if (!option) throw new Error('The fixture target did not resolve before the manual capture click.');
    await window.streamApi.prepareDesktopCapture(option.id, false);

    const button = document.createElement('button');
    button.id = 'capture-restore-manual-probe';
    button.type = 'button';
    button.textContent = 'Start manual capture probe';
    Object.assign(button.style, { position: 'fixed', zIndex: '2147483647', right: '12px', bottom: '12px', padding: '12px' });
    button.addEventListener('click', () => {
      void (async () => {
        try {
          // Invoke directly in the trusted click handler so Electron 44 sees a
          // user gesture at setDisplayMediaRequestHandler.
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          const video = document.createElement('video');
          video.muted = true;
          video.srcObject = stream;
          await video.play();
          await new Promise((resolve) => setTimeout(resolve, 900));
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(video, 0, 0);
          const pixel = Array.from(context.getImageData(Math.floor(canvas.width * 0.12), Math.floor(canvas.height * 0.16), 1, 1).data).slice(0, 3);
          window.__manualCaptureProbe = {
            finished: true,
            ok: true,
            width: video.videoWidth,
            height: video.videoHeight,
            pixel,
            tracks: stream.getVideoTracks().map((track) => ({ readyState: track.readyState, muted: track.muted, settings: track.getSettings() })),
          };
          stream.getTracks().forEach((track) => track.stop());
        } catch (error) {
          window.__manualCaptureProbe = { finished: true, ok: false, error: String(error), stack: error && error.stack };
        }
      })();
    }, { once: true });
    document.body.append(button);
    return { id: option.id, name: option.name };
  }, { id: expectedTarget.id, kind: 'window', name: SOURCE_NAME, target: expectedTarget.target });

  await page.locator('#capture-restore-manual-probe').click({ timeout: 10000 });
  await page.waitForFunction(() => window.__manualCaptureProbe?.finished === true, undefined, { timeout: 20000 });
  const observation = await page.evaluate(() => window.__manualCaptureProbe);
  if (!observation.ok) throw new Error(`Manual getDisplayMedia failed: ${JSON.stringify(observation)}`);
  return { selectedTarget: prepared, observation };
}

async function readTrace(tracePath) {
  const content = await fs.readFile(tracePath, 'utf8').catch(() => '');
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function countRestorePrepares(tracePath) {
  return (await readTrace(tracePath)).filter((entry) => entry.kind === 'ipc-request'
    && entry.channel === 'stream:prepare-desktop-capture' && entry.args?.[2] === 'automatic-restore').length;
}

(async () => {
  const artifactRoot = path.join(root, 'output', 'playwright', 'capture-restore-e2e');
  const runRoot = path.join(artifactRoot, `run-${new Date().toISOString().replaceAll(':', '-')}`);
  await fs.mkdir(runRoot, { recursive: true });
  const artifacts = {
    runRoot,
    targetScreenshot: path.join(runRoot, 'target-fixture.png'),
    initialScreenshot: path.join(runRoot, 'stream-initial.png'),
    reloadScreenshot: path.join(runRoot, 'stream-after-reload.png'),
    restartScreenshot: path.join(runRoot, 'stream-after-restart.png'),
    report: path.join(runRoot, 'report.json'),
    trace: path.join(runRoot, 'stream-trace.ndjson'),
    streamConsole: path.join(runRoot, 'stream-console.log'),
    targetConsole: path.join(runRoot, 'target-console.log'),
  };
  const targetRoot = path.join(runRoot, 'target-app');
  const probeRoot = path.join(runRoot, 'enumerator');
  const streamAppData = path.join(runRoot, 'stream-app-data');
  const targetBootstrap = path.join(targetRoot, 'target.cjs');
  const streamBootstrap = path.join(runRoot, 'stream.cjs');
  await Promise.all([fs.mkdir(targetRoot, { recursive: true }), fs.mkdir(probeRoot, { recursive: true })]);

  const [targetPort, enumeratorPort, streamPort] = await uniquePorts(3);
  const ports = { target: targetPort, enumerator: enumeratorPort, stream: streamPort };
  const report = {
    electronVersion,
    electronPath,
    builtEntry: BINARY,
    ports,
    targetTitle: TARGET_TITLE,
    phases: [],
    artifacts,
    limitations: [],
  };
  const rendererErrors = [];
  let targetApp = null;
  let streamApp = null;
  let targetPage = null;
  let streamPage = null;
  let fixture = null;
  try {
    if (electronVersion !== '44.3.0') throw new Error(`Expected apps/stream Electron 44.3.0, got ${electronVersion} at ${electronPath}`);
    if (!fsSync.existsSync(BINARY)) throw new Error(`Built Stream entry not found: ${BINARY}`);

    await writeBootstrap(targetBootstrap, `
      const { app, BrowserWindow } = require('electron');
      app.setPath('appData', ${JSON.stringify(path.join(targetRoot, 'app-data'))});
      app.setName('LumaStream Capture Restore Fixture');
      app.whenReady().then(async () => {
        const window = new BrowserWindow({
          title: ${JSON.stringify(TARGET_TITLE)}, width: 820, height: 500, x: 0, y: 60, show: true,
          backgroundColor: '#1ca671', webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + ${JSON.stringify(TARGET_TITLE)} + '</title><style>html,body{width:100%;height:100%;margin:0;background:#1ca671;color:white;font:700 34px system-ui;display:grid;place-items:center}</style></head><body>CAPTURE RESTORE FIXTURE</body></html>';
        await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        window.setTitle(${JSON.stringify(TARGET_TITLE)});
      });
    `);
    targetApp = await launchApp([targetBootstrap], ports.target);
    const targetChild = targetApp.process();
    targetChild.stdout?.on('data', (data) => fsSync.appendFileSync(artifacts.targetConsole, data));
    targetChild.stderr?.on('data', (data) => fsSync.appendFileSync(artifacts.targetConsole, data));
    targetPage = await targetApp.firstWindow();
    await targetPage.waitForLoadState('domcontentloaded');
    await targetPage.waitForFunction(() => document.body?.textContent?.includes('CAPTURE RESTORE FIXTURE'));
    await targetPage.screenshot({ path: artifacts.targetScreenshot });
    report.targetProcessId = targetApp.process().pid;
    if (targetApp.process().exitCode !== null || targetApp.process().signalCode !== null) throw new Error('Fixture target app exited before external source enumeration.');

    const targetProbe = await readTargetOption(probeRoot, TARGET_TITLE, ports.enumerator);
    const targetOption = targetProbe.option;
    report.targetOption = targetOption;
    report.screenAccessStatusFromEnumerator = targetProbe.screenAccessStatus;
    report.targetEnumerationCounts = targetProbe.enumerationCounts;
    report.targetOptionHash = targetOption.appIconHash ?? null;
    fixture = await seedStreamProject(streamAppData, targetOption);
    report.fixture = {
      activeSceneId: fixture.ids.previewSceneId,
      liveSceneId: fixture.ids.liveSceneId,
      captureSourceId: fixture.ids.captureSourceId,
      captureBindingId: fixture.ids.captureBindingId,
      previewColorId: fixture.ids.previewColorId,
      dataDirectory: fixture.dataDirectory,
    };
    await writeBootstrap(streamBootstrap, streamBootstrapBody(streamAppData, artifacts.trace));

    const openStream = async (phase) => {
      streamApp = await launchApp([streamBootstrap], ports.stream);
      const child = streamApp.process();
      child.stdout?.on('data', (data) => fsSync.appendFileSync(artifacts.streamConsole, data));
      child.stderr?.on('data', (data) => fsSync.appendFileSync(artifacts.streamConsole, data));
      streamPage = await streamApp.firstWindow();
      streamPage.on('pageerror', (error) => rendererErrors.push({ phase, error: error.message }));
      streamPage.on('console', (message) => {
        if (message.type() === 'error') rendererErrors.push({ phase, console: message.text() });
      });
      await streamPage.locator('.program-panel canvas').waitFor({ state: 'attached', timeout: 30000 });
      return streamPage;
    };

    const phaseCheck = async (phase, screenshotPath) => {
      const observation = await waitForState(streamPage, (state) => state.studioMode
        && state.liveVideoTracks.length > 0, phase);
      observation.programPixelMatchesFixture = nearColor(observation.programPixel, TARGET_COLOR);
      const captureDeviceIds = observation.liveVideoTracks.map((track) => track.settings?.deviceId).filter(Boolean);
      if (!captureDeviceIds.includes(targetOption.id)) {
        throw new Error(`${phase}: live Program track did not bind the exact resolved source ${targetOption.id}: ${JSON.stringify(captureDeviceIds)}`);
      }
      observation.captureDeviceIdsMatchFixture = true;
      const previewOk = nearColor(observation.previewPixel, PREVIEW_COLOR);
      if (!previewOk) throw new Error(`${phase}: staged Preview pixel did not remain purple: ${JSON.stringify(observation.previewPixel)}`);
      const sourceRowState = await assertNoWarningRow(streamPage);
      await returnToPreview(streamPage);
      const persisted = await readPersistedProject(streamPage);
      if (persisted.liveSceneId !== fixture.ids.liveSceneId || persisted.activeSceneId !== fixture.ids.previewSceneId
        || persisted.studioMode !== true) {
        throw new Error(`${phase}: Studio Program/Preview metadata changed unexpectedly: ${JSON.stringify(persisted)}`);
      }
      if (persisted.previewSource?.color !== '#6342ab'
        || persisted.previewSource?.transform?.width !== 1280 || persisted.previewSource?.transform?.height !== 720) {
        throw new Error(`${phase}: unrelated staged Preview metadata was committed or changed: ${JSON.stringify(persisted.previewSource)}`);
      }
      await streamPage.screenshot({ path: screenshotPath });
      return { observation, persisted, sourceRowState };
    };

    await openStream('initial-startup');
    const initial = await phaseCheck('initial-startup', artifacts.initialScreenshot);
    const manualCapture = await probeManualDisplayCapture(streamPage, {
      id: targetOption.id,
      target: { kind: 'window', name: targetOption.name.slice(0, 512), ...(targetOption.appIconHash ? { appIconHash: targetOption.appIconHash } : {}) },
    });
    report.manualCapture = manualCapture;
    const manualEvents = (await readTrace(artifacts.trace)).filter((entry) => entry.kind === 'display-media-request' || entry.kind === 'display-media-result');
    report.manualCapture.events = manualEvents;
    if (!manualEvents.some((entry) => entry.kind === 'display-media-request' && entry.userGesture === true)) {
      throw new Error(`Manual request did not reach setDisplayMediaRequestHandler with userGesture=true: ${JSON.stringify(manualEvents)}`);
    }
    if (!manualEvents.some((entry) => entry.kind === 'display-media-result' && entry.sourceId === targetOption.id)) {
      throw new Error(`Manual request handler did not return the exact selected fixture source: ${JSON.stringify(manualEvents)}`);
    }
    const initialPrepareCount = await countRestorePrepares(artifacts.trace);
    if (initialPrepareCount < 1) throw new Error('Initial startup did not request automatic-restore authorization.');
    report.phases.push({ name: 'initial-startup', prepareCount: initialPrepareCount, ...initial });

    const beforeReload = await countRestorePrepares(artifacts.trace);
    await streamPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await streamPage.locator('.program-panel canvas').waitFor({ state: 'attached', timeout: 30000 });
    const afterReload = await phaseCheck('renderer-reload', artifacts.reloadScreenshot);
    const reloadPrepareCount = await countRestorePrepares(artifacts.trace);
    if (reloadPrepareCount <= beforeReload) throw new Error('Renderer reload did not run automatic restoration again.');
    report.phases.push({ name: 'renderer-reload', beforePrepareCount: beforeReload, prepareCount: reloadPrepareCount, ...afterReload });

    const beforeRestart = reloadPrepareCount;
    await closeElectron(streamApp);
    streamApp = null;
    streamPage = null;
    if (targetApp.process().exitCode !== null || targetApp.process().signalCode !== null) throw new Error('Fixture target app exited before the Stream restart phase.');
    await openStream('main-process-restart');
    const afterRestart = await phaseCheck('main-process-restart', artifacts.restartScreenshot);
    const restartPrepareCount = await countRestorePrepares(artifacts.trace);
    if (restartPrepareCount <= beforeRestart) throw new Error('Stream process restart did not run automatic restoration again.');
    report.phases.push({ name: 'main-process-restart', beforePrepareCount: beforeRestart, prepareCount: restartPrepareCount, ...afterRestart });

    report.nativePixelChecks = report.phases.map((phase) => ({
      phase: phase.name,
      programPixel: phase.observation.programPixel,
      videoSamplePixels: phase.observation.videos.map((video) => video.samplePixel),
      matchesFixture: phase.observation.programPixelMatchesFixture,
    }));
    if (report.nativePixelChecks.some((check) => !check.matchesFixture)) {
      report.limitations.push('Electron 44 on this host returns black frames for windows owned by another Electron process, across both GUM and GDM; exact native source thumbnails remain green. Pixel delivery is recorded diagnostically.');
    }
    if (rendererErrors.length > 0) throw new Error(`Renderer logged errors: ${JSON.stringify(rendererErrors)}`);
    const trace = await readTrace(artifacts.trace);
    const permissionEvents = trace.filter((entry) => entry.kind === 'permission-request' || entry.kind === 'permission-result');
    report.permissionEvents = permissionEvents;
    report.manualDisplayMediaEvents = manualEvents;
    report.captureTraceSummary = trace.filter((entry) => entry.kind.startsWith('ipc-'));
    report.rendererErrors = rendererErrors;
    report.passed = true;
    report.checks = [
      'Electron 44.3.0 built Stream main launched with isolated appData',
      'separate visible fixture window selected by exact target title only',
      'saved target metadata and captureBindingId restored on startup',
      'Program keeps a live track bound to the exact fresh fixture source ID',
      'Program canvas and raw video pixels are sampled and reported as a host-native diagnostic',
      'manual display picker request reaches Electron 44 handler with userGesture and returns the exact selected fixture source',
      'source row has no warning or unavailable indicator',
      'renderer reload automatically resolves and recaptures without the picker',
      'Stream process restart recaptures while the same target process remains open',
      'Studio Mode Program remains live while Preview color/transform metadata remains staged',
      'no renderer page errors or console errors',
    ];
    await fs.writeFile(artifacts.report, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, runRoot, electronVersion, targetOption, phasePrepareCounts: report.phases.map(({ name, prepareCount }) => ({ name, prepareCount })), screenshots: [artifacts.initialScreenshot, artifacts.reloadScreenshot, artifacts.restartScreenshot], trace: artifacts.trace }));
  } catch (error) {
    report.passed = false;
    report.error = String(error);
    report.stack = error?.stack;
    report.rendererErrors = rendererErrors;
    try {
      if (streamPage) {
        report.failurePage = await inspectPage(streamPage);
        await streamPage.screenshot({ path: path.join(runRoot, 'failure-stream.png'), timeout: 10000 }).catch(() => undefined);
      }
    } catch { /* Preserve the primary failure. */ }
    report.captureTraceSummary = await readTrace(artifacts.trace).catch(() => []);
    await fs.writeFile(artifacts.report, JSON.stringify(report, null, 2));
    console.error(JSON.stringify({ passed: false, runRoot, error: String(error), failurePage: report.failurePage, trace: artifacts.trace }));
    process.exitCode = 1;
  } finally {
    await closeElectron(streamApp);
    await closeElectron(targetApp);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function streamBootstrapBody(appDataPath, tracePath) {
  return streamBootstrap(appDataPath, tracePath);
}

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
process.chdir(root);
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const streamRequire = createRequire(path.join(root, 'apps/stream/package.json'));
const electronPath = streamRequire('electron');
const electronVersion = JSON.parse(fsSync.readFileSync(streamRequire.resolve('electron/package.json'), 'utf8')).version;
const FIXTURE_TITLE = 'LumaStream Capture Method Fixture';
const BACKGROUND = '#1ca671';
const EXPECTED = [28, 166, 113];

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

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function closeApp(app) {
  if (!app) return;
  let child;
  try { child = app.process(); } catch { return; }
  let closed = false;
  try {
    await Promise.race([
      app.close().then(() => { closed = true; }),
      new Promise((resolve) => setTimeout(resolve, 7000)),
    ]);
  } catch { /* The app may already have quit. */ }
  if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await waitForExit(child, 2000);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function bootstrapBody(appData, tracePath, resultPath) {
  return `
    const fs = require('node:fs');
    const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, systemPreferences } = require('electron');
    app.setPath('appData', ${JSON.stringify(appData)});
    const tracePath = ${JSON.stringify(tracePath)};
    const resultPath = ${JSON.stringify(resultPath)};
    const trace = (entry) => fs.appendFileSync(tracePath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\\n');
    let fixtureWindow;
    let pending = null;
    const enumerated = new Map();
    const types = { window: 'window', screen: 'screen' };

    ipcMain.handle('probe:list', async (_event, kind) => {
      const sources = await desktopCapturer.getSources({ types: [types[kind]], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
      const now = Date.now();
      for (const [id, entry] of enumerated) if (now - entry.at > 30000) enumerated.delete(id);
      for (const source of sources) enumerated.set(source.id, { kind, at: now });
      if (kind === 'window') {
        const fixture = sources.filter((source) => source.name === ${JSON.stringify(FIXTURE_TITLE)});
        trace({ kind: 'enumerate-window', totalSources: sources.length, fixtureMatches: fixture.map(({ id, name }) => ({ id, name })) });
        return fixture.map((source) => ({ id: source.id, name: source.name, kind, displayId: source.display_id || undefined }));
      }
      const mapped = sources.map((source) => ({ id: source.id, name: source.name, kind, displayId: source.display_id || undefined }));
      trace({ kind: 'enumerate-screen', totalSources: mapped.length, sources: mapped });
      return mapped;
    });
    ipcMain.handle('probe:authorize', (_event, mode, kind, sourceId) => {
      const listed = enumerated.get(sourceId);
      if (!listed || listed.kind !== kind || Date.now() - listed.at > 30000) throw new Error('Capture source was not freshly enumerated.');
      pending = { mode, kind, sourceId, webContentsId: fixtureWindow.webContents.id, expiresAt: Date.now() + 15000 };
      trace({ kind: 'authorize', ...pending });
    });
    ipcMain.handle('probe:meta', () => ({ screenAccessStatus: systemPreferences.getMediaAccessStatus('screen'),
      primaryDisplay: screen.getPrimaryDisplay(), fullscreen: fixtureWindow?.isFullScreen() ?? false }));

    app.whenReady().then(() => {
      trace({ kind: 'system-access', screen: systemPreferences.getMediaAccessStatus('screen') });
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const mediaTypes = details && 'mediaTypes' in details ? details.mediaTypes : undefined;
        let allowed = false;
        if (permission === 'media' && mediaTypes?.length === 0
          && (pending?.mode === 'automatic-restore' || pending?.mode === 'display-media')
          && pending.webContentsId === webContents.id && pending.expiresAt >= Date.now()) {
          allowed = true;
          if (pending.mode === 'automatic-restore') pending = null;
        }
        trace({ kind: 'permission-request', permission, mediaTypes, allowed, webContentsId: webContents.id });
        callback(allowed);
      });
      session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
        if (permission === 'media' && details.mediaType === undefined) {
          return (pending?.mode === 'automatic-restore' || pending?.mode === 'display-media')
            && pending.webContentsId === webContents.id && pending.expiresAt >= Date.now();
        }
        return permission === 'media' && (details.mediaType === 'audio' || details.mediaType === 'video');
      });
      session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        const active = pending;
        const trustedFrame = Boolean(fixtureWindow && request.frame === fixtureWindow.webContents.mainFrame
          && request.frame.url.startsWith('file://'));
        trace({ kind: 'display-media-request', userGesture: request.userGesture, videoRequested: request.videoRequested,
          audioRequested: request.audioRequested, trustedFrame, pending: active && { ...active } });
        if (!active || active.mode !== 'display-media' || !trustedFrame || !request.userGesture
          || !request.videoRequested || active.webContentsId !== fixtureWindow.webContents.id || active.expiresAt < Date.now()) {
          callback({});
          return;
        }
        pending = null;
        const sources = await desktopCapturer.getSources({ types: [types[active.kind]], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
        const source = sources.find((item) => item.id === active.sourceId);
        trace({ kind: 'display-media-result', selectedSourceId: source?.id ?? null, sourceName: source?.name ?? null });
        callback(source ? { video: source } : {});
      });

      fixtureWindow = new BrowserWindow({
        title: ${JSON.stringify(FIXTURE_TITLE)}, width: 1000, height: 700, show: true,
        backgroundColor: ${JSON.stringify(BACKGROUND)},
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
      });
      fixtureWindow.webContents.setBackgroundThrottling(false);
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + ${JSON.stringify(FIXTURE_TITLE)} + '</title>'
        + '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${BACKGROUND};color:${BACKGROUND};font:1px sans-serif}'
        + '#manual-capture{position:fixed;left:4px;top:4px;width:80px;height:24px;border:0;padding:0;background:${BACKGROUND};color:${BACKGROUND};opacity:1}'
        + '.probe-video{position:fixed;left:-10000px;top:-10000px;width:2px;height:2px}</style></head><body>'
        + '<button id="manual-capture" aria-label="Run manual display capture">manual</button><script>'
        + 'const {ipcRenderer}=require("electron");'
        + 'async function measure(stream,method,kind){'
        + 'const video=document.createElement("video");video.className="probe-video";video.muted=true;video.playsInline=true;video.srcObject=stream;document.body.append(video);'
        + 'await video.play();await new Promise(resolve=>{if(video.readyState>=2)resolve();else video.addEventListener("loadeddata",resolve,{once:true})});'
        + 'await new Promise(resolve=>setTimeout(resolve,500));const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;'
        + 'const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(video,0,0);const x=Math.floor(canvas.width*.5),y=Math.floor(canvas.height*.5);'
        + 'const pixel=Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);const track=stream.getVideoTracks()[0];'
        + 'const result={method,kind,pixel,width:video.videoWidth,height:video.videoHeight,currentTime:video.currentTime,trackReadyState:track?.readyState,trackMuted:track?.muted,trackLabel:track?.label,trackSettings:track?.getSettings()};'
        + 'stream.getTracks().forEach(track=>track.stop());video.remove();return result;}'
        + 'window.runAutomatic=async(kind,source)=>{await ipcRenderer.invoke("probe:authorize","automatic-restore",kind,source.id);'
        + 'const stream=await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:"desktop",chromeMediaSourceId:source.id,maxFrameRate:30}},audio:false});'
        + 'return measure(stream,"legacy-getUserMedia",kind);};'
        + 'window.prepareManual=async(kind,source)=>{await ipcRenderer.invoke("probe:authorize","display-media",kind,source.id);window.__manualSource={kind,source};};'
        + 'document.querySelector("#manual-capture").addEventListener("click",()=>{const pending=window.__manualSource;window.__manualResult=null;'
        + 'if(!pending){window.__manualResult={error:"missing prepared source"};return;}'
        + 'navigator.mediaDevices.getDisplayMedia({video:true,audio:false}).then(stream=>measure(stream,"getDisplayMedia",pending.kind))'
        + '.then(result=>window.__manualResult=result).catch(error=>window.__manualResult={method:"getDisplayMedia",kind:pending.kind,error:String(error)});});'
        + '</script></body></html>';
      const fixturePath = require('node:path').join(__dirname, 'fixture.html');
      fs.writeFileSync(fixturePath, html);
      fixtureWindow.loadFile(fixturePath).then(() => {
        fixtureWindow.setTitle(${JSON.stringify(FIXTURE_TITLE)});
        fixtureWindow.setFullScreen(true);
      });
      app.on('before-quit', () => {
        try { fs.writeFileSync(resultPath, JSON.stringify({ electronVersion: process.versions.electron,
          screenAccessStatus: systemPreferences.getMediaAccessStatus('screen'), primaryDisplay: screen.getPrimaryDisplay(), fullscreen: fixtureWindow?.isFullScreen() }, null, 2)); } catch {}
      });
    });
  `;
}

function matches(pixel) {
  return Array.isArray(pixel) && pixel.length === 3 && pixel.every((channel, index) => Math.abs(channel - EXPECTED[index]) <= 12);
}

(async () => {
  const artifactRoot = path.join(root, 'output', 'playwright', 'capture-restore-e2e');
  const runRoot = path.join(artifactRoot, `method-probe-${new Date().toISOString().replaceAll(':', '-')}`);
  await fs.mkdir(runRoot, { recursive: true });
  const appData = path.join(runRoot, 'app-data');
  const bootstrap = path.join(runRoot, 'probe.cjs');
  const tracePath = path.join(runRoot, 'trace.ndjson');
  const resultPath = path.join(runRoot, 'main-process.json');
  const screenshotPath = path.join(runRoot, 'fixture-window.png');
  const port = await freePort();
  const reportPath = path.join(runRoot, 'report.json');
  let app = null;
  const rendererErrors = [];
  const results = [];
  const report = { electronVersion, electronPath, port, runRoot, fixtureTitle: FIXTURE_TITLE, expectedColor: EXPECTED, results, rendererErrors };

  try {
    if (electronVersion !== '44.3.0') throw new Error(`Expected Electron 44.3.0, got ${electronVersion} at ${electronPath}`);
    await fs.writeFile(bootstrap, bootstrapBody(appData, tracePath, resultPath), 'utf8');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await electron.launch({ executablePath: electronPath, args: [`--remote-debugging-port=${port}`, bootstrap], env, timeout: 30000 });
    const child = app.process();
    child.stdout?.on('data', (data) => fsSync.appendFileSync(path.join(runRoot, 'electron-console.log'), data));
    child.stderr?.on('data', (data) => fsSync.appendFileSync(path.join(runRoot, 'electron-console.log'), data));
    const page = await app.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(document.querySelector('#manual-capture')));
    await page.waitForTimeout(800);
    await page.screenshot({ path: screenshotPath });

    const options = await page.evaluate(async () => {
      const ipc = require('electron').ipcRenderer;
      const [windows, screens] = await Promise.all([ipc.invoke('probe:list', 'window'), ipc.invoke('probe:list', 'screen')]);
      return { windows, screens };
    });
    report.sourceOptions = options;
    if (options.windows.length !== 1) throw new Error(`Expected only the fixture window to match; found ${options.windows.length}.`);
    if (options.screens.length < 1) throw new Error('Electron returned no display sources.');
    const targetWindow = options.windows[0];
    const targetScreen = options.screens[0];

    const runGum = async (kind, source) => page.evaluate(async ({ kind: sourceKind, source: option }) => {
      return window.runAutomatic(sourceKind, option);
    }, { kind, source });
    const runDisplayMedia = async (kind, source, ordinal) => {
      await page.evaluate(async ({ kind: sourceKind, source: option }) => window.prepareManual(sourceKind, option), { kind, source });
      await page.locator('#manual-capture').click({ timeout: 10000 });
      await page.waitForFunction(() => window.__manualResult !== null, { timeout: 15000 });
      const result = await page.evaluate(() => window.__manualResult);
      await fs.writeFile(path.join(runRoot, `after-${ordinal}.json`), JSON.stringify(result, null, 2));
      return result;
    };

    results.push(await runGum('window', targetWindow));
    results.push(await runDisplayMedia('window', targetWindow, 'window-display-media'));
    results.push(await runGum('screen', targetScreen));
    results.push(await runDisplayMedia('screen', targetScreen, 'screen-display-media'));

    report.nativeMainState = await page.evaluate(() => require('electron').ipcRenderer.invoke('probe:meta'));
    report.mainTrace = (await fs.readFile(tracePath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    report.rendererErrors = rendererErrors;
    report.results = results;
    report.passed = results.length === 4 && results.every((result) => !result.error && result.trackReadyState === 'live');
    report.pixelChecks = results.map((result) => ({ method: result.method, kind: result.kind, pixel: result.pixel, matchesFixture: matches(result.pixel) }));
    report.allPixelsMatch = report.pixelChecks.every((entry) => entry.matchesFixture);
    if (rendererErrors.length > 0) throw new Error(`Renderer errors: ${rendererErrors.join('\n')}`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, allPixelsMatch: report.allPixelsMatch, runRoot, pixelChecks: report.pixelChecks, mainTrace: tracePath }));
    if (!report.passed) throw new Error(`One or more Electron 44 native capture modes failed: ${JSON.stringify(results)}`);
  } catch (error) {
    report.passed = false;
    report.error = String(error);
    report.stack = error?.stack;
    report.rendererErrors = rendererErrors;
    if (!report.mainTrace) report.mainTrace = (await fs.readFile(tracePath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.error(JSON.stringify({ passed: false, allPixelsMatch: report.allPixelsMatch, runRoot, error: String(error), results, trace: tracePath }));
    process.exitCode = 1;
  } finally {
    await closeApp(app);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

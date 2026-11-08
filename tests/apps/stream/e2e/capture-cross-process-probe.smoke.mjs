import { resolveAppElectron } from '../../../../tool/app-electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
process.chdir(root);
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { binaryPath: electronPath, version: electronVersion } = resolveAppElectron('stream');
const TARGET_TITLE = 'LumaStream External Capture Fixture';
const GREEN = '#1ca671';
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
    await Promise.race([app.close().then(() => { closed = true; }), new Promise((resolve) => setTimeout(resolve, 7000))]);
  } catch { /* The app may already have quit. */ }
  if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await waitForExit(child, 2000);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function electronEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  return env;
}

function targetBootstrap(appData) {
  return `
    const { app, BrowserWindow, screen } = require('electron');
    app.setPath('appData', ${JSON.stringify(appData)});
    app.whenReady().then(async () => {
      const bounds = screen.getPrimaryDisplay().workArea;
      const window = new BrowserWindow({ title: ${JSON.stringify(TARGET_TITLE)}, x: bounds.x, y: bounds.y, width: 800, height: 520,
        show: true, backgroundColor: ${JSON.stringify(GREEN)}, webPreferences: { contextIsolation: true, nodeIntegration: false } });
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + ${JSON.stringify(TARGET_TITLE)} + '</title>'
        + '<style>html,body{width:100%;height:100%;margin:0;background:${GREEN};color:white;font:700 34px system-ui;display:grid;place-items:center}</style>'
        + '</head><body>EXTERNAL FIXTURE TARGET</body></html>';
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      window.setTitle(${JSON.stringify(TARGET_TITLE)});
    });
  `;
}

function receiverBootstrap(appData, tracePath, targetTitle, green) {
  return `
    const fs = require('node:fs');
    const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, systemPreferences } = require('electron');
    app.setPath('appData', ${JSON.stringify(appData)});
    const tracePath = ${JSON.stringify(tracePath)};
    const trace = (entry) => fs.appendFileSync(tracePath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\\n');
    let receiver = null;
    let pending = null;
    const listed = new Map();
    ipcMain.handle('probe:list', async (_event, kind) => {
      const sources = await desktopCapturer.getSources({ types: [kind], thumbnailSize: kind === 'window' ? { width: 320, height: 200 } : { width: 0, height: 0 }, fetchWindowIcons: true });
      const timestamp = Date.now();
      for (const [id, entry] of listed) if (timestamp - entry.at > 30000) listed.delete(id);
      for (const source of sources) listed.set(source.id, { kind, at: timestamp });
      const selected = kind === 'window' ? sources.filter((source) => source.name === ${JSON.stringify(targetTitle)}) : sources;
      for (const source of selected) {
        if (kind === 'window' && source.thumbnail && !source.thumbnail.isEmpty()) {
          fs.writeFileSync(require('node:path').join(require('node:path').dirname(tracePath), 'native-window-thumbnail.png'), source.thumbnail.toPNG());
        }
      }
      trace({ kind: 'enumeration', captureKind: kind, matches: selected.map((source) => ({ id: source.id, name: source.name, displayId: source.display_id || undefined })) });
      return selected.map((source) => ({ id: source.id, name: source.name, kind, displayId: source.display_id || undefined }));
    });
    ipcMain.handle('probe:authorize', (_event, mode, kind, sourceId) => {
      const option = listed.get(sourceId);
      if (!option || option.kind !== kind || Date.now() - option.at > 30000) throw new Error('Source was not freshly enumerated.');
      pending = { mode, kind, sourceId, webContentsId: receiver.webContents.id, expiresAt: Date.now() + 15000 };
      trace({ kind: 'authorize', ...pending });
    });
    ipcMain.handle('probe:state', () => ({ screenAccessStatus: systemPreferences.getMediaAccessStatus('screen'), primaryDisplay: screen.getPrimaryDisplay() }));
    app.whenReady().then(() => {
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const mediaTypes = details && 'mediaTypes' in details ? details.mediaTypes : undefined;
        const allowed = permission === 'media' && mediaTypes?.length === 0 && pending?.webContentsId === webContents.id
          && pending.expiresAt >= Date.now() && (pending.mode === 'automatic-restore' || pending.mode === 'display-media');
        trace({ kind: 'permission-request', permission, mediaTypes, allowed, webContentsId: webContents.id });
        callback(Boolean(allowed));
      });
      session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
        if (permission !== 'media') return false;
        if (details.mediaType === undefined) return Boolean(pending?.webContentsId === webContents.id && pending.expiresAt >= Date.now());
        return details.mediaType === 'audio' || details.mediaType === 'video';
      });
      session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        const active = pending;
        const trusted = Boolean(receiver && request.frame === receiver.webContents.mainFrame && request.frame.url.startsWith('file://'));
        trace({ kind: 'display-media-request', userGesture: request.userGesture, videoRequested: request.videoRequested, audioRequested: request.audioRequested, trusted,
          pending: active && { ...active } });
        if (!active || active.mode !== 'display-media' || !trusted || !request.userGesture || !request.videoRequested
          || active.webContentsId !== receiver.webContents.id || active.expiresAt < Date.now()) {
          callback({});
          return;
        }
        pending = null;
        const sources = await desktopCapturer.getSources({ types: [active.kind], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
        const source = sources.find((item) => item.id === active.sourceId);
        trace({ kind: 'display-media-result', selectedSourceId: source?.id ?? null, sourceName: source?.name ?? null });
        callback(source ? { video: source } : {});
      });

      receiver = new BrowserWindow({ x: 820, y: 30, width: 1080, height: 760, show: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
      receiver.webContents.setBackgroundThrottling(false);
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>Capture Receiver</title>'
        + '<style>body{font:16px system-ui;background:#202020;color:#eee}button{padding:14px}</style></head><body>'
        + '<button id="manual">Start manual display capture</button><script>'
        + 'const {ipcRenderer}=require("electron");'
        + 'window.measure=async(stream,method,kind,sample)=>{const video=document.createElement("video");video.muted=true;video.playsInline=true;video.srcObject=stream;'
        + 'await video.play();await new Promise(resolve=>{if(video.readyState>=2)resolve();else video.addEventListener("loadeddata",resolve,{once:true})});'
        + 'await new Promise(resolve=>setTimeout(resolve,650));const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;'
        + 'const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(video,0,0);const x=Math.max(0,Math.min(canvas.width-1,Math.floor(sample.x*canvas.width)));'
        + 'const y=Math.max(0,Math.min(canvas.height-1,Math.floor(sample.y*canvas.height)));const pixel=Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);'
        + 'const track=stream.getVideoTracks()[0];const result={method,kind,pixel,width:video.videoWidth,height:video.videoHeight,currentTime:video.currentTime,readyState:track?.readyState,muted:track?.muted,label:track?.label,settings:track?.getSettings()};'
        + 'stream.getTracks().forEach(track=>track.stop());video.srcObject=null;return result;};'
        + 'window.runAutomatic=async(kind,source,sample)=>{await ipcRenderer.invoke("probe:authorize","automatic-restore",kind,source.id);'
        + 'const stream=await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:"desktop",chromeMediaSourceId:source.id,maxFrameRate:30}},audio:false});'
        + 'return window.measure(stream,"legacy-getUserMedia",kind,sample);};'
        + 'window.prepareManual=async(kind,source,sample)=>{await ipcRenderer.invoke("probe:authorize","display-media",kind,source.id);window.__manual={kind,source,sample};};'
        + 'document.querySelector("#manual").addEventListener("click",()=>{const request=window.__manual;window.__manualResult=null;'
        + 'if(!request){window.__manualResult={error:"no prepared target"};return;}navigator.mediaDevices.getDisplayMedia({video:true,audio:false})'
        + '.then(stream=>window.measure(stream,"getDisplayMedia",request.kind,request.sample)).then(result=>window.__manualResult=result)'
        + '.catch(error=>window.__manualResult={method:"getDisplayMedia",kind:request.kind,error:String(error)});});'
        + '</script></body></html>';
      const file = require('node:path').join(__dirname, 'receiver.html');
      fs.writeFileSync(file, html);
      receiver.loadFile(file);
    });
  `;
}

function matching(pixel) {
  return Array.isArray(pixel) && pixel.length === 3 && pixel.every((channel, index) => Math.abs(channel - EXPECTED[index]) <= 12);
}

(async () => {
  const artifactRoot = path.join(root, 'output', 'playwright', 'capture-restore-e2e');
  const runRoot = path.join(artifactRoot, `cross-process-method-probe-${new Date().toISOString().replaceAll(':', '-')}`);
  const targetRoot = path.join(runRoot, 'target');
  const receiverRoot = path.join(runRoot, 'receiver');
  await Promise.all([fs.mkdir(targetRoot, { recursive: true }), fs.mkdir(receiverRoot, { recursive: true })]);
  const targetBootstrapPath = path.join(targetRoot, 'target.cjs');
  const receiverBootstrapPath = path.join(receiverRoot, 'receiver.cjs');
  const tracePath = path.join(runRoot, 'trace.ndjson');
  const reportPath = path.join(runRoot, 'report.json');
  const screenshotPath = path.join(runRoot, 'external-target.png');
  const [targetPort, receiverPort] = await Promise.all([freePort(), freePort()]);
  const report = { runRoot, electronVersion, electronPath, targetTitle: TARGET_TITLE, expectedColor: EXPECTED, ports: { target: targetPort, receiver: receiverPort }, results: [] };
  let targetApp = null;
  let receiverApp = null;
  try {
    await fs.writeFile(targetBootstrapPath, targetBootstrap(path.join(targetRoot, 'app-data')), 'utf8');
    await fs.writeFile(receiverBootstrapPath, receiverBootstrap(path.join(receiverRoot, 'app-data'), tracePath, TARGET_TITLE, GREEN), 'utf8');
    const launch = (bootstrap, port) => electron.launch({ executablePath: electronPath, args: [`--remote-debugging-port=${port}`, bootstrap], env: electronEnv(), timeout: 30000 });
    targetApp = await launch(targetBootstrapPath, targetPort);
    const targetPage = await targetApp.firstWindow();
    await targetPage.waitForFunction(() => document.body?.textContent?.includes('EXTERNAL FIXTURE TARGET'));
    await targetPage.screenshot({ path: screenshotPath });
    receiverApp = await launch(receiverBootstrapPath, receiverPort);
    const page = await receiverApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#manual');
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => require('electron').ipcRenderer.invoke('probe:state'));
    report.receiverState = state;
    const options = await page.evaluate(async () => {
      const ipc = require('electron').ipcRenderer;
      const [windows, screens] = await Promise.all([ipc.invoke('probe:list', 'window'), ipc.invoke('probe:list', 'screen')]);
      return { windows, screens };
    });
    report.options = options;
    if (options.windows.length !== 1) throw new Error(`Expected one external target; found ${options.windows.length}: ${JSON.stringify(options.windows)}`);
    const target = options.windows[0];
    const targetDisplay = target.displayId ?? String(state.primaryDisplay.id);
    const screen = options.screens.find((option) => String(option.displayId) === targetDisplay) ?? options.screens[0];
    if (!screen) throw new Error('No screen source was listed.');
    const targetBounds = state.primaryDisplay.workArea;
    report.fixtureBounds = { x: targetBounds.x, y: targetBounds.y, width: 800, height: 520 };
    const screenSample = {
      x: (targetBounds.x + 400 - state.primaryDisplay.bounds.x) / state.primaryDisplay.bounds.width,
      y: (targetBounds.y + 260 - state.primaryDisplay.bounds.y) / state.primaryDisplay.bounds.height,
    };
    const centerSample = { x: 0.5, y: 0.5 };
    const runGum = (kind, source, sample) => page.evaluate(({ kind: sourceKind, option, point }) => window.runAutomatic(sourceKind, option, point), { kind, option: source, point: sample });
    const runGdm = async (kind, source, sample, suffix) => {
      await page.evaluate(({ kind: sourceKind, option, point }) => window.prepareManual(sourceKind, option, point), { kind, option: source, point: sample });
      await page.locator('#manual').click({ timeout: 10000 });
      await page.waitForFunction(() => window.__manualResult !== null, undefined, { timeout: 15000 });
      const result = await page.evaluate(() => window.__manualResult);
      await fs.writeFile(path.join(runRoot, `${suffix}.json`), JSON.stringify(result, null, 2));
      return result;
    };
    report.results.push(await runGum('window', target, centerSample));
    report.results.push(await runGdm('window', target, centerSample, 'window-get-display-media'));
    report.results.push(await runGum('screen', screen, screenSample));
    report.results.push(await runGdm('screen', screen, screenSample, 'screen-get-display-media'));
    report.trace = (await fs.readFile(tracePath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    report.passed = report.results.length === 4 && report.results.every((result) => result.readyState === 'live' && matching(result.pixel));
    report.pixelChecks = report.results.map(({ method, kind, pixel }) => ({ method, kind, pixel, matchesFixture: matching(pixel) }));
    report.targetScreenshot = screenshotPath;
    report.reportPath = reportPath;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, runRoot, target, screen, pixelChecks: report.pixelChecks, tracePath }));
    if (!report.passed) throw new Error(`Cross-process Electron44 capture differs from fixture: ${JSON.stringify(report.pixelChecks)}`);
  } catch (error) {
    report.passed = false;
    report.error = String(error);
    report.stack = error?.stack;
    if (!report.trace) report.trace = (await fs.readFile(tracePath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.error(JSON.stringify({ passed: false, runRoot, error: String(error), results: report.results }));
    process.exitCode = 1;
  } finally {
    await closeApp(receiverApp);
    await closeApp(targetApp);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

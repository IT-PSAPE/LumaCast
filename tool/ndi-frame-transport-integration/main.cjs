'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  utilityProcess,
} = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const FRAME_BYTES = 1920 * 1080 * 4;
const EXPECTED_MARKERS = [11, 22, 33, 44, 55, 66, 77];
const REQUEST_CHANNEL = 'ndi:requestFrameTransport';
const SET_OUTPUT_CHANNEL = 'ndi:setOutputEnabled';
const PORT_CHANNEL = 'ndi:frameTransportPort';
const ANNOUNCEMENT_TYPE = 'lumacast:ndi-frame-transport-port';
const TEST_TIMEOUT_MS = 30_000;

let host = null;
let window = null;
let temporaryDirectory = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markerRgb(marker, slot) {
  return [
    (marker + slot * 17) & 255,
    (marker * 3 + slot * 29) & 255,
    (marker ^ (165 + slot)) & 255,
  ];
}

function packedMarker(marker, slot) {
  const [red, green, blue] = markerRgb(marker, slot);
  return (red << 16) | (green << 8) | blue;
}

function createHostObserver(child) {
  const history = [];
  const waiters = [];
  child.on('message', (message) => {
    history.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  return {
    history,
    waitFor(predicate, label, timeoutMs = 10_000, afterIndex = 0) {
      const existing = history.slice(afterIndex).find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`timed out waiting for NDI host ${label}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

async function waitForRendererResult(browserWindow) {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await browserWindow.webContents.executeJavaScript(
      'window.__ndiTransportResult ?? null',
      true,
    );
    if (result) return result;
    await delay(50);
  }
  throw new Error('timed out waiting for renderer Worker transport result');
}

function validateFrameReport(reportPath) {
  const lines = fs.readFileSync(reportPath, 'utf8').trim().split('\n').filter(Boolean);
  const frames = lines.map((line) => JSON.parse(line));
  const markerLookup = new Map(EXPECTED_MARKERS.map((marker) => [packedMarker(marker, 0), marker]));
  const directFrames = frames.filter((frame) => markerLookup.has(frame.marker0));
  assert.ok(directFrames.length >= EXPECTED_MARKERS.length, 'mock runtime did not receive every direct frame');

  for (const frame of directFrames) {
    const marker = markerLookup.get(frame.marker0);
    assert.equal(frame.width, 1920);
    assert.equal(frame.height, 1080);
    assert.equal(frame.stride, 1920 * 4);
    for (let slot = 0; slot < 4; slot += 1) {
      assert.equal(
        frame[`marker${slot}`],
        packedMarker(marker, slot),
        `marker ${marker} was corrupted at sample ${slot}`,
      );
    }
  }

  const transitions = [];
  for (const frame of directFrames) {
    const marker = markerLookup.get(frame.marker0);
    if (transitions.at(-1) !== marker) transitions.push(marker);
  }
  assert.deepEqual(
    transitions.slice(0, EXPECTED_MARKERS.length),
    EXPECTED_MARKERS,
    'direct frames reached the NDI runtime out of order',
  );
}

async function run() {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-ndi-transport-'));
  const frameReportPath = path.join(temporaryDirectory, 'frames.ndjson');
  const pacingReportPath = path.join(temporaryDirectory, 'pacing.json');
  const mockRuntimePath = path.join(
    ROOT,
    'packages',
    'ndi-native',
    'test',
    'fixtures',
    'libndi_mock.dylib',
  );
  const hostModulePath = path.join(ROOT, 'out', 'main', 'ndi-host.js');
  const preloadPath = path.join(ROOT, 'out', 'preload', 'preload.js');
  const rendererPath = path.join(__dirname, 'renderer.html');
  for (const requiredPath of [mockRuntimePath, hostModulePath, preloadPath, rendererPath]) {
    assert.ok(fs.existsSync(requiredPath), `required integration-test artifact is missing: ${requiredPath}`);
  }

  host = utilityProcess.fork(hostModulePath, [], {
    serviceName: 'ndi-frame-transport-integration-host',
    stdio: 'pipe',
    env: {
      ...process.env,
      CAST_NDI_RUNTIME_PATH: mockRuntimePath,
      NDI_MOCK_REPORT_PATH: pacingReportPath,
      NDI_MOCK_FRAME_REPORT_PATH: frameReportPath,
    },
  });
  host.stdout?.resume();
  host.stderr?.resume();
  const observer = createHostObserver(host);

  host.postMessage({
    type: 'init',
    outputConfigs: {
      audience: { senderName: 'LumaCast transport integration', withAlpha: false },
      stage: { senderName: 'LumaCast transport integration stage', withAlpha: false },
    },
  });
  await observer.waitFor((message) => message.type === 'ready', 'ready');
  host.postMessage({ type: 'setOutputEnabled', name: 'audience', enabled: true });
  await observer.waitFor(
    (message) => message.type === 'outputStateChanged' && message.outputState.audience === true,
    'audience sender enablement',
  );

  let attachedChannels = 0;
  const outputCycles = [];
  ipcMain.on(REQUEST_CHANNEL, (event, payload) => {
    assert.deepEqual(payload, { name: 'audience' });
    const { port1, port2 } = new MessageChannelMain();
    host.postMessage({ type: 'attachFramePort', name: 'audience' }, [port2]);
    event.senderFrame.postMessage(
      PORT_CHANNEL,
      { type: ANNOUNCEMENT_TYPE, version: 1, name: 'audience' },
      [port1],
    );
    attachedChannels += 1;
  });
  ipcMain.handle(SET_OUTPUT_CHANNEL, async (_event, name, enabled) => {
    assert.equal(name, 'audience');
    assert.equal(typeof enabled, 'boolean');
    const afterIndex = observer.history.length;
    host.postMessage({ type: 'setOutputEnabled', name, enabled });
    const stateChanged = await observer.waitFor(
      (message) => message.type === 'outputStateChanged' && message.outputState.audience === enabled,
      `audience ${enabled ? 'enablement' : 'disablement'}`,
      10_000,
      afterIndex,
    );
    outputCycles.push(enabled);
    return stateChanged.outputState;
  });

  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  const pageErrors = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') pageErrors.push(details.message);
  });
  await window.loadFile(rendererPath);
  const result = await waitForRendererResult(window);
  assert.equal(result.ok, true, result.error ?? 'renderer Worker integration failed');
  assert.equal(result.generation, 4, 'expected replacement, fallback, and recovery transport generations');
  assert.equal(attachedChannels, 4, 'expected four MessageChannelMain attachments');
  assert.deepEqual(outputCycles, [false, true, false, true], 'expected two output teardown/restart cycles');
  assert.deepEqual(
    result.fallbacks,
    [{ type: 'fallback', name: 'audience', reason: 'invalidHandshake' }],
    'invalid transport handshake must trigger a typed fallback before recovery',
  );
  assert.deepEqual(
    result.retainedByteLengths,
    EXPECTED_MARKERS.map(() => FRAME_BYTES),
    'posting without a transfer list must not detach the Worker ArrayBuffers',
  );
  assert.deepEqual(
    result.releases.map((release) => release.attemptId),
    [
      'electron-direct-1-11',
      'electron-direct-1-22',
      'electron-direct-1-33',
      'electron-direct-2-44',
      'electron-direct-2-55',
      'electron-direct-4-66',
      'electron-direct-4-77',
    ],
  );
  assert.ok(result.releases.every((release) => release.accepted && release.reason === 'sent'));
  assert.equal(
    observer.history.filter((message) => message.type === 'frameReleased').length,
    0,
    'direct releases must stay on the Worker-to-utility MessagePort',
  );
  assert.deepEqual(pageErrors, [], `renderer reported errors: ${pageErrors.join('; ')}`);

  host.postMessage({ type: 'destroy' });
  await observer.waitFor((message) => message.type === 'teardownComplete', 'teardown');
  validateFrameReport(frameReportPath);
  console.log('NDI direct transport integration passed: 7 intact 1920x1080 frames, ordered releases, replacement, fallback recovery, two output cycles, teardown');
}

async function cleanup() {
  ipcMain.removeAllListeners(REQUEST_CHANNEL);
  ipcMain.removeHandler(SET_OUTPUT_CHANNEL);
  if (window && !window.isDestroyed()) window.destroy();
  if (host) {
    try {
      host.kill();
    } catch {
      // The utility process may already have exited.
    }
  }
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

app.whenReady()
  .then(run)
  .then(async () => {
    await cleanup();
    app.quit();
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup();
    app.exit(1);
  });

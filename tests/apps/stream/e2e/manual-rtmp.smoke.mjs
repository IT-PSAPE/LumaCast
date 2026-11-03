import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const root = process.cwd();
const appRequire = createRequire(path.resolve('apps/stream/package.json'));
const playwrightRequire = createRequire(path.resolve('package.json'));
const { _electron: electron, expect } = playwrightRequire('@playwright/test');
const electronBinary = appRequire('electron');
const electronVersion = appRequire('electron/package.json').version;
const ffmpegExecutable = path.resolve('apps/stream/vendor/ffmpeg/bin/ffmpeg');
const outputRoot = path.resolve('output/playwright/manual-rtmp-smoke');
const observationMs = 9000;
const requireLive = process.argv.includes('--require-live');

function classifySafeError(message) {
  const value = String(message).toLowerCase();
  if (/connection refused|econnrefused/.test(value)) return 'connection-refused';
  if (/timed? ?out|timeout|etimedout/.test(value)) return 'timeout';
  if (/invalid data|could not find codec|end of file|ebml/.test(value)) return 'input-probe';
  if (/encoder|videotoolbox|h264/.test(value)) return 'encoder';
  if (/network|rtmp|tls|ssl|socket|broken pipe|epipe/.test(value)) return 'transport';
  return 'other';
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildFingerprint() {
  const rendererIndexPath = path.resolve('apps/stream/out/renderer/index.html');
  const rendererHtml = await fs.readFile(rendererIndexPath, 'utf8');
  const rendererAssets = [...rendererHtml.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)].map((match) => match[1]);
  return {
    mainBundleSha256: await sha256(path.resolve('apps/stream/out/main/index.js')),
    rendererAssets,
  };
}

function writeFixtureBootstrap(runRoot, appDataPath, appRootPath) {
  const bootstrap = path.join(runRoot, 'bootstrap.cjs');
  const mainEntry = path.resolve('apps/stream/out/main/index.js');
  const source = `
const { app, ipcMain } = require('electron');
const childProcess = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
app.setPath('appData', ${JSON.stringify(appDataPath)});
// The test launches a bootstrap script instead of the app directory; match its app path
// that the development launcher supplies so Stream resolves its own FFmpeg build.
app.getAppPath = () => ${JSON.stringify(appRootPath)};

const fixture = globalThis.__manualRtmpProbe = {
  startedAt: Date.now(),
  destination: null,
  startRequests: 0,
  startErrors: [],
  writesRequested: 0,
  writesAccepted: 0,
  writeErrors: [],
  bytesRequested: 0,
  bytesAccepted: 0,
  pendingWrites: 0,
  firstWriteAt: null,
  encoderChildren: [],
  isEncoder(command, args) {
    return path.basename(String(command)) === 'ffmpeg'
      && Array.isArray(args) && args.includes('pipe:0') && args.includes('pipe:2');
  },
  safeSnapshot() {
    return {
      startedAt: this.startedAt,
      destination: this.destination,
      startRequests: this.startRequests,
      startErrors: [...this.startErrors],
      writesRequested: this.writesRequested,
      writesAccepted: this.writesAccepted,
      writeErrors: [...this.writeErrors],
      bytesRequested: this.bytesRequested,
      bytesAccepted: this.bytesAccepted,
      pendingWrites: this.pendingWrites,
      firstWriteAt: this.firstWriteAt,
      encoderChildren: this.encoderChildren.map(({ pid, spawnedAt, progressEvents, progressEndCount, progressBuffer, bitrateKbps, outTimeMs, errorCategories, exitCode, signalCode, executableExists, spawnErrorCode }) => ({
        pid, spawnedAt, progressEvents, progressEndCount, bitrateKbps, outTimeMs, executableExists, spawnErrorCode,
        errorCategories: [...errorCategories], exitCode, signalCode,
      })),
    };
  },
};

function safeErrorCategory(message) {
  const value = String(message).toLowerCase();
  if (/connection refused|econnrefused/.test(value)) return 'connection-refused';
  if (/timed? ?out|timeout|etimedout/.test(value)) return 'timeout';
  if (/invalid data|could not find codec|end of file|ebml/.test(value)) return 'input-probe';
  if (/encoder|videotoolbox|h264/.test(value)) return 'encoder';
  if (/network|rtmp|tls|ssl|socket|broken pipe|epipe/.test(value)) return 'transport';
  return 'other';
}

const originalSpawn = childProcess.spawn;
childProcess.spawn = function(command, args, options) {
  const child = originalSpawn.call(this, command, args, options);
  if (!fixture.isEncoder(command, args)) return child;
  const processRecord = {
    pid: child.pid ?? null,
    spawnedAt: Date.now(),
    progressEvents: 0,
    progressEndCount: 0,
    progressBuffer: '',
    bitrateKbps: 0,
    outTimeMs: null,
    errorCategories: [],
    executableExists: fs.existsSync(command),
    spawnErrorCode: null,
    exitCode: null,
    signalCode: null,
  };
  fixture.encoderChildren.push(processRecord);
  child.stderr.on('data', (chunk) => {
    processRecord.progressBuffer += chunk.toString('utf8');
    const lines = processRecord.progressBuffer.split(/\\r?\\n/);
    processRecord.progressBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('bitrate=')) {
        const value = Number.parseFloat(line.slice('bitrate='.length).replace(/kbits\\/s$/, '').trim());
        if (Number.isFinite(value)) processRecord.bitrateKbps = Math.max(0, Math.round(value));
      }
      if (line.startsWith('out_time_ms=')) {
        const value = Number.parseInt(line.slice('out_time_ms='.length), 10);
        if (Number.isFinite(value)) processRecord.outTimeMs = value;
      }
      if (line.startsWith('progress=')) {
        if (line === 'progress=end') processRecord.progressEndCount += 1;
        else processRecord.progressEvents += 1;
      }
      if (/^\\[.*\\] (error|fatal):/i.test(line)) processRecord.errorCategories.push(safeErrorCategory(line));
    }
  });
  child.on('error', (error) => {
    processRecord.spawnErrorCode = error?.code ?? null;
    processRecord.errorCategories.push(safeErrorCategory(error?.message ?? ''));
  });
  child.on('close', (code, signal) => {
    processRecord.exitCode = code;
    processRecord.signalCode = signal;
  });
  return child;
};

const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (channel === 'stream:start-output') {
    fixture.startRequests += 1;
    try {
      const url = new URL(args[0]);
      fixture.destination = { protocol: url.protocol, host: url.hostname, port: url.port, loopback: url.hostname === '127.0.0.1' };
    } catch {
      fixture.destination = { protocol: 'invalid', loopback: false };
    }
    try {
      return await listener(event, ...args);
    } catch (error) {
      fixture.startErrors.push(safeErrorCategory(error?.message ?? ''));
      throw error;
    }
  }
  if (channel === 'stream:write-output-chunk') {
    const bytes = args[1];
    const byteLength = bytes && typeof bytes.byteLength === 'number' ? bytes.byteLength : 0;
    fixture.writesRequested += 1;
    fixture.bytesRequested += byteLength;
    fixture.pendingWrites += 1;
    if (fixture.firstWriteAt === null) fixture.firstWriteAt = Date.now();
    try {
      const result = await listener(event, ...args);
      fixture.writesAccepted += 1;
      fixture.bytesAccepted += byteLength;
      return result;
    } catch (error) {
      fixture.writeErrors.push(safeErrorCategory(error?.message ?? ''));
      throw error;
    } finally {
      fixture.pendingWrites -= 1;
    }
  }
  return listener(event, ...args);
});

require(${JSON.stringify(mainEntry)});
`;
  return fs.writeFile(bootstrap, source, 'utf8').then(() => bootstrap);
}

async function waitForTcpListener(pid, port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const output = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 1000 });
      if (output.includes(':' + port + ' (LISTEN)')) return true;
    } catch { /* lsof returns nonzero until the listener opens. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function safeTcpSocketCount(pid) {
  try {
    const output = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP'], { encoding: 'utf8', timeout: 1000 });
    return Math.max(0, output.trim().split(/\r?\n/).length - 1);
  } catch {
    return null;
  }
}

function readProgress(parser, chunk) {
  parser.buffer += chunk.toString('utf8');
  const lines = parser.buffer.split(/\r?\n/);
  parser.buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.startsWith('progress=')) {
      if (line === 'progress=end') parser.progressEndCount += 1;
      else parser.progressEvents += 1;
    }
    if (line.startsWith('frame=')) {
      const frame = Number.parseInt(line.slice('frame='.length), 10);
      if (Number.isFinite(frame)) parser.lastFrame = frame;
    }
    if (line.startsWith('out_time_ms=')) {
      const value = Number.parseInt(line.slice('out_time_ms='.length), 10);
      if (Number.isFinite(value)) parser.outTimeMs = value;
    }
  }
}

function startReceiver(port, destination) {
  const receiver = spawn(ffmpegExecutable, [
    '-hide_banner', '-loglevel', 'info', '-nostats', '-progress', 'pipe:1',
    '-listen', '1', '-i', destination,
    '-map', '0:v:0', '-c:v', 'copy', '-f', 'null', '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const progress = { buffer: '', progressEvents: 0, progressEndCount: 0, lastFrame: 0, outTimeMs: null };
  const receiverState = { pid: receiver.pid ?? null, inputOpened: false, errorCategories: [], exitCode: null, signalCode: null, progress };
  receiver.stdout.on('data', (chunk) => readProgress(progress, chunk));
  receiver.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (/^Input #0, flv,/m.test(text)) receiverState.inputOpened = true;
    for (const line of text.split(/\r?\n/)) {
      if (/^\[.*\] (error|fatal):/i.test(line)) receiverState.errorCategories.push(classifySafeError(line));
    }
  });
  receiver.on('error', (error) => receiverState.errorCategories.push(classifySafeError(error.message)));
  receiver.on('close', (code, signal) => {
    receiverState.exitCode = code;
    receiverState.signalCode = signal;
  });
  return { process: receiver, state: receiverState };
}

async function closeElectron(app) {
  if (!app) return;
  let child;
  try { child = app.process(); } catch { return; }
  let closed = false;
  try {
    await Promise.race([
      app.close().then(() => { closed = true; }),
      new Promise((resolve) => setTimeout(resolve, 18000)),
    ]);
  } catch { /* The process may already have exited after a renderer failure. */ }
  if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function stopReceiver(receiver) {
  if (!receiver || receiver.exitCode !== null || receiver.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (receiver.exitCode === null && receiver.signalCode === null) receiver.kill('SIGTERM');
      resolve();
    }, 3000);
    receiver.once('close', () => { clearTimeout(timer); resolve(); });
  });
  if (receiver.exitCode === null && receiver.signalCode === null) receiver.kill('SIGKILL');
}

function mediaRecorderInitSource() {
  return `(() => {
    const probe = window.__manualRtmpRecorderProbe = { records: [], installError: '' };
    try {
      const NativeMediaRecorder = window.MediaRecorder;
      if (!NativeMediaRecorder) throw new Error('MediaRecorder unavailable');
      const recordsByRecorder = new WeakMap();
      const originalStart = NativeMediaRecorder.prototype.start;
      NativeMediaRecorder.prototype.start = function(timeslice) {
        const record = recordsByRecorder.get(this);
        if (record) {
          record.startRequestedAt = performance.now();
          record.timesliceMs = Number.isFinite(timeslice) ? timeslice : null;
        }
        return originalStart.call(this, timeslice);
      };
      const ProxyMediaRecorder = new Proxy(NativeMediaRecorder, {
        construct(target, args) {
          const recorder = Reflect.construct(target, args);
          const [stream] = args;
          const record = {
            mimeType: recorder.mimeType || args[1]?.mimeType || '',
            trackKinds: stream?.getTracks?.().map((track) => ({ kind: track.kind, readyState: track.readyState, enabled: track.enabled, muted: track.muted })) ?? [],
            startRequestedAt: null,
            timesliceMs: null,
            dataEvents: 0,
            emptyEvents: 0,
            nonemptyChunks: 0,
            totalBytes: 0,
            firstNonemptyMs: null,
            firstChunkSizes: [],
            errorNames: [],
          };
          recordsByRecorder.set(recorder, record);
          probe.records.push(record);
          recorder.addEventListener('dataavailable', (event) => {
            record.dataEvents += 1;
            const size = event.data?.size ?? 0;
            if (size <= 0) { record.emptyEvents += 1; return; }
            if (record.firstNonemptyMs === null && record.startRequestedAt !== null) {
              record.firstNonemptyMs = Math.round(performance.now() - record.startRequestedAt);
            }
            record.nonemptyChunks += 1;
            record.totalBytes += size;
            if (record.firstChunkSizes.length < 6) record.firstChunkSizes.push(size);
          });
          recorder.addEventListener('error', (event) => record.errorNames.push(event.error?.name ?? 'unknown'));
          return recorder;
        },
      });
      window.MediaRecorder = ProxyMediaRecorder;
    } catch (error) {
      probe.installError = error instanceof Error ? error.name + ': ' + error.message : 'MediaRecorder instrumentation failed';
    }
  })();`;
}

async function main() {
  assert.equal(electronVersion, '44.3.0', `Expected Stream Electron 44.3.0, resolved ${electronVersion}.`);
  assert.equal(process.platform, 'darwin', 'This probe is scoped to the active macOS failure.');
  await fs.access(ffmpegExecutable);
  const versionOutput = execFileSync(ffmpegExecutable, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 10000 });
  const ffmpegVersion = versionOutput.split(/\r?\n/)[0] ?? 'unknown';
  const fingerprint = await buildFingerprint();
  assert.match(ffmpegVersion, /ffmpeg version/i, 'The Stream FFmpeg executable did not report its version.');
  const rtmpHelp = execFileSync(ffmpegExecutable, ['-hide_banner', '-h', 'protocol=rtmp'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(rtmpHelp, /-listen\s+<int>/, 'The Stream FFmpeg build does not expose RTMP listen mode.');

  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const runRoot = path.join(outputRoot, `run-${stamp}-${process.pid}`);
  const appDataPath = path.join(runRoot, 'app-data');
  const streamDataDirectory = path.join(appDataPath, 'LumaStream');
  await fs.mkdir(streamDataDirectory, { recursive: true });
  const port = await freePort();
  const destination = `rtmp://127.0.0.1:${port}/live/probe`;
  await fs.writeFile(path.join(streamDataDirectory, 'stream-settings.json'), JSON.stringify({
    version: 1,
    service: 'custom',
    serverId: '',
    customServer: destination,
    streamKeyEncoding: 'plain',
    streamKey: '',
    youtube: { title: '', description: '', privacy: 'unlisted', broadcastId: '', scheduledStartTime: '' },
    zoom: { selectedMeetingId: '', topic: '', startTime: '', durationMinutes: 60 },
  }, null, 2));
  const bootstrap = await writeFixtureBootstrap(runRoot, appDataPath, path.resolve('apps/stream'));
  const { process: receiver, state: receiverState } = startReceiver(port, destination);
  const receiverListening = await waitForTcpListener(receiver.pid, port);
  assert.ok(receiverListening, 'The local FFmpeg RTMP receiver did not bind its loopback port.');

  const debugPort = await freePort();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [`--remote-debugging-port=${debugPort}`, '--autoplay-policy=no-user-gesture-required', bootstrap],
    env,
    cwd: path.resolve('apps/stream'),
    timeout: 30000,
  });
  const rendererErrors = [];
  let page;
  let stopButtonClicked = false;
  let mainSnapshot = null;
  let rendererSnapshot = null;
  let afterStopSnapshot = null;
  let workspaceSnapshot = null;
  let failure = null;

  try {
    page = await app.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push({ kind: 'pageerror', name: error.name }));
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push({ kind: 'console', text: message.text().slice(0, 160) });
    });
    await page.addInitScript({ content: mediaRecorderInitSource() });
    await page.reload();
    await page.locator('.program-panel canvas.composition-canvas').waitFor({ state: 'visible', timeout: 30000 });
    workspaceSnapshot = await page.evaluate(async () => {
      const workspace = await window.streamApi.loadProject();
      const sources = workspace.project.scenes.flatMap((scene) => scene.sources);
      const settings = await window.streamApi.loadStreamServiceSettings();
      window.__manualRtmpStatuses = [];
      window.__manualRtmpUnsubscribe = window.streamApi.onStreamStatus((status) => {
        window.__manualRtmpStatuses.push({
          state: status.state,
          outputId: status.outputId ?? 'primary',
          bitrateKbps: Number.isFinite(status.bitrateKbps) ? status.bitrateKbps : null,
        });
      });
      return {
        projectOutput: {
          width: workspace.project.output.width,
          height: workspace.project.output.height,
          frameRate: workspace.project.output.frameRate,
          encoder: workspace.project.output.streamVideoEncoder,
        },
        sourceCount: sources.length,
        audioSourceCount: sources.filter((source) => ['microphone', 'desktop-audio', 'system-audio', 'application-audio', 'browser'].includes(source.kind)).length,
        service: settings.service,
        serverId: settings.serverId,
        keyConfigured: settings.streamKey.length > 0,
        canvasPresent: Boolean(document.querySelector('.program-panel canvas.composition-canvas')),
      };
    });
    assert.equal(workspaceSnapshot.service, 'custom');
    assert.equal(workspaceSnapshot.keyConfigured, false);
    assert.equal(workspaceSnapshot.canvasPresent, true);
    assert.equal(workspaceSnapshot.audioSourceCount, 0, 'The isolated project must keep the Stream mixer empty.');

    const startButton = page.locator('.controls-dock').getByRole('button', { name: 'Start Streaming', exact: true });
    await expect(startButton).toBeVisible({ timeout: 30000 });
    await startButton.click();
    await expect(page.getByText('Stream settings', { exact: true })).toBeVisible({ timeout: 10000 });
    const settingsDialog = page.locator('.stream-modal');
    await settingsDialog.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(settingsDialog).toBeHidden({ timeout: 15000 });
    await expect(page.locator('.controls-dock .control-output-row')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(observationMs);

    mainSnapshot = await app.evaluate(() => globalThis.__manualRtmpProbe.safeSnapshot());
    rendererSnapshot = await page.evaluate(() => ({
      mediaRecorder: window.__manualRtmpRecorderProbe,
      statuses: [...(window.__manualRtmpStatuses ?? [])],
      outputRows: [...document.querySelectorAll('.controls-dock .control-output-row')].map((row) => row.innerText.replace(/\s+/g, ' ').trim()),
    }));
    const observedState = rendererSnapshot.statuses.at(-1)?.state ?? 'unknown';
    const screenshotPath = path.join(runRoot, `state-${observedState}.png`);
    await page.screenshot({ path: screenshotPath });
    mainSnapshot.encoderChildren = mainSnapshot.encoderChildren.map((child) => ({
      ...child,
      tcpSocketCount: child.pid ? safeTcpSocketCount(child.pid) : null,
    }));
    receiverState.tcpListenVerified = receiverListening;
    receiverState.tcpSocketCount = receiver.pid ? safeTcpSocketCount(receiver.pid) : null;

    const recorder = rendererSnapshot.mediaRecorder?.records?.[0] ?? null;
    const nonemptyChunks = recorder?.nonemptyChunks ?? 0;
    const outcome = nonemptyChunks === 0 && mainSnapshot.writesRequested === 0
      ? 'no-recorder-data'
      : mainSnapshot.writesAccepted === 0
        ? 'chunk-ipc-not-accepted'
        : (mainSnapshot.encoderChildren[0]?.progressEvents ?? 0) === 0
          ? 'ffmpeg-no-progress'
          : receiverState.inputOpened || receiverState.progress.lastFrame > 0
            ? 'local-rtmp-received-media'
            : 'ffmpeg-progress-without-receiver-confirmation';

    const summary = {
      passed: true,
      expectedMode: requireLive ? 'live' : 'diagnostic',
      outcome,
      electronVersion,
      buildFingerprint: fingerprint,
      ffmpegVersion,
      streamFfmpegPath: 'apps/stream/vendor/ffmpeg/bin/ffmpeg',
      loopbackReceiver: {
        protocol: 'rtmp',
        host: '127.0.0.1',
        port,
        listenFlagAvailable: true,
        tcpListenVerified: receiverListening,
        inputOpened: receiverState.inputOpened,
        frames: receiverState.progress.lastFrame,
        progressEvents: receiverState.progress.progressEvents,
        errorCategories: receiverState.errorCategories,
        tcpSocketCount: receiverState.tcpSocketCount,
        exitCode: receiverState.exitCode,
        signalCode: receiverState.signalCode,
      },
      project: workspaceSnapshot,
      renderer: {
        recorderInstrumentationError: rendererSnapshot.mediaRecorder?.installError ?? 'unknown',
        recorders: rendererSnapshot.mediaRecorder?.records ?? [],
        statuses: rendererSnapshot.statuses,
        outputRows: rendererSnapshot.outputRows,
        errors: rendererErrors,
      },
      main: mainSnapshot,
      observationMs,
      screenshot: path.basename(screenshotPath),
      note: 'The test used isolated appData, an empty default audio mixer, and a loopback-only RTMP receiver. It did not use YouTube credentials, provider APIs, cameras, microphones, or an external ingest service. Destination path and stream key were not recorded.',
    };

    if (requireLive) {
      assert.ok((recorder?.nonemptyChunks ?? 0) > 0, 'Expected MediaRecorder to emit nonempty chunks.');
      assert.ok(mainSnapshot.writesAccepted > 0, 'Expected the stream chunk IPC to accept media.');
      assert.ok(mainSnapshot.encoderChildren.some((child) => child.progressEvents > 0), 'Expected FFmpeg progress to be observed.');
      assert.ok(receiverState.inputOpened || receiverState.progress.lastFrame > 0, 'Expected the local RTMP receiver to receive the output.');
      assert.ok(rendererSnapshot.statuses.some((status) => status.state === 'live'), 'Expected transport status to become live.');
    }

    const stopButton = page.getByRole('button', { name: /^(Cancel|Stop) Output$/ });
    if (await stopButton.isVisible().catch(() => false)) {
      await stopButton.click();
      stopButtonClicked = true;
      await page.getByRole('button', { name: 'Start Streaming', exact: true }).waitFor({ timeout: 15000 }).catch(() => undefined);
      afterStopSnapshot = await page.evaluate(() => ({
        statuses: [...(window.__manualRtmpStatuses ?? [])],
        startButtonVisible: [...document.querySelectorAll('.controls-dock button')].some((button) => button.textContent?.trim() === 'Start Streaming'),
        outputRows: [...document.querySelectorAll('.controls-dock .control-output-row')].map((row) => row.innerText.replace(/\s+/g, ' ').trim()),
      }));
    }
    summary.renderer.afterStop = afterStopSnapshot;
    if (requireLive) {
      assert.ok(rendererSnapshot.statuses.some((status) => status.state === 'connecting'), 'Expected the output to expose Connecting before Live.');
      assert.ok(stopButtonClicked, 'Expected the Controls Stop action to be available and used.');
      assert.equal(afterStopSnapshot?.startButtonVisible, true, 'Expected Controls to return to Start Streaming after Stop.');
      assert.equal(afterStopSnapshot?.statuses.at(-1)?.state, 'stopped', 'Expected the output status to settle to stopped after Stop.');
    }
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'summary.json'), JSON.stringify({ ...summary, stopButtonClicked }, null, 2));
    console.log(JSON.stringify({ runRoot: path.relative(root, runRoot), outcome: summary.outcome, project: summary.project, renderer: summary.renderer, main: summary.main, receiver: summary.loopbackReceiver }, null, 2));
  } catch (error) {
    failure = error;
    const safeMainSnapshot = await app.evaluate(() => globalThis.__manualRtmpProbe.safeSnapshot()).catch(() => null);
    const safeRendererSnapshot = page ? await page.evaluate(() => ({
      mediaRecorder: window.__manualRtmpRecorderProbe,
      statuses: [...(window.__manualRtmpStatuses ?? [])],
    })).catch(() => null) : null;
    mainSnapshot = mainSnapshot ?? safeMainSnapshot;
    rendererSnapshot = rendererSnapshot ?? safeRendererSnapshot;
    const diagnostic = {
      passed: false,
      expectedMode: requireLive ? 'live' : 'diagnostic',
      errorName: error instanceof Error ? error.name : 'Error',
      errorCategory: classifySafeError(error instanceof Error ? error.message : ''),
      electronVersion,
      buildFingerprint: fingerprint,
      ffmpegVersion,
      loopbackReceiver: {
        protocol: 'rtmp', host: '127.0.0.1', port,
        tcpListenVerified: receiverListening,
        inputOpened: receiverState.inputOpened,
        frames: receiverState.progress.lastFrame,
        errorCategories: receiverState.errorCategories,
      },
      project: workspaceSnapshot,
      renderer: rendererSnapshot,
      main: mainSnapshot,
      rendererErrors,
      note: 'Failure output is sanitized; stream destination and media bytes are not written to the report.',
    };
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'failure.json'), JSON.stringify(diagnostic, null, 2));
    if (page) await page.screenshot({ path: path.join(runRoot, 'failure.png') }).catch(() => undefined);
    console.error(JSON.stringify({ runRoot: path.relative(root, runRoot), ...diagnostic }, null, 2));
  } finally {
    if (page) {
      const stopButton = page.getByRole('button', { name: /^(Cancel|Stop) Output$/ });
      if (await stopButton.isVisible().catch(() => false)) {
        await stopButton.click({ timeout: 3000 }).catch(() => undefined);
        stopButtonClicked = true;
        await page.waitForTimeout(1000).catch(() => undefined);
      }
    }
    await closeElectron(app);
    await stopReceiver(receiver);
  }

  if (failure) throw failure;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

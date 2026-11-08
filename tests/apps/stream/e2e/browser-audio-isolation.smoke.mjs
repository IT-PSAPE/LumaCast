import { resolveAppElectron } from '../../../../tool/app-electron.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '../../../..');
process.chdir(repoRoot);

const playwrightRequire = createRequire(path.resolve(repoRoot, 'package.json'));
const { _electron: electron } = playwrightRequire('@playwright/test');
const { binaryPath: electronBinary, version: electronVersion } = resolveAppElectron('stream');
const mainPath = path.resolve(repoRoot, 'apps/stream/out/main/index.js');
const streamWorkingDirectory = path.resolve(repoRoot, 'apps/stream');
const outputDirectory = path.resolve(repoRoot, 'output/playwright/browser-audio-isolation');
const runId = new Date().toISOString().replaceAll(':', '-');
const resultPath = path.join(outputDirectory, `result-${runId}.json`);
const startupLogPath = path.join(outputDirectory, `startup-${runId}.log`);
const captureSeconds = 3;
const selectedFrequencyHz = 440;
const otherFrequencyHz = 660;

function makeTonePage(label, frequencyHz) {
  return `<!doctype html><meta charset="utf-8"><title>${label}</title>
<body><h1>${label} local audio fixture</h1><output id="state">starting</output>
<script>
window.startTone = async () => {
  if (window.__tone) return window.__tone;
  const context = new AudioContext();
  await context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = ${frequencyHz};
  gain.gain.value = 0.06;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  window.__tone = { label: ${JSON.stringify(label)}, frequencyHz: oscillator.frequency.value, sampleRate: context.sampleRate, state: context.state };
  document.querySelector('#state').value = context.state;
  return window.__tone;
};
void window.startTone();
</script></body>`;
}

function goertzelAmplitude(samples, sampleRate, frequencyHz) {
  const count = samples.length;
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousPrevious = 0;
  let windowSum = 0;
  for (let index = 0; index < count; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (count - 1));
    windowSum += window;
    const current = samples[index] * window + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
  }
  const power = previous * previous + previousPrevious * previousPrevious - coefficient * previous * previousPrevious;
  const amplitude = (2 * Math.sqrt(Math.max(0, power))) / windowSum;
  return {
    frequencyHz,
    peakAmplitude: Number(amplitude.toPrecision(6)),
    levelDbfs: Number((20 * Math.log10(Math.max(amplitude, Number.MIN_VALUE))).toFixed(2)),
  };
}

async function waitFor(description, readValue, isReady, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let latest;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await readValue();
    if (isReady(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description}; latest value: ${JSON.stringify(latest)}`);
}

await fs.mkdir(outputDirectory, { recursive: true });
const scratchDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'stream-browser-isolation-'));
const isolatedUserDataDirectory = path.join(scratchDirectory, 'bootstrap-user-data');
const bootstrapPath = path.join(scratchDirectory, 'bootstrap.cjs');
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/youtube') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(makeTonePage('YouTube', selectedFrequencyHz));
    return;
  }
  if (url.pathname === '/meeting') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(makeTonePage('meeting', otherFrequencyHz));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('fixture not found');
});

let app;
let primaryError;
let outcome;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '::', resolve);
  });
  const port = server.address().port;
  const youtubeUrl = `http://localhost:${port}/youtube`;
  const meetingUrl = `http://127.0.0.1:${port}/meeting`;

  const bootstrap = `
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const log = (message) => fs.appendFileSync(${JSON.stringify(startupLogPath)}, String(message) + '\\n');
process.on('uncaughtException', (error) => log('uncaughtException ' + error.stack));
process.on('unhandledRejection', (error) => log('unhandledRejection ' + (error && error.stack || error)));
app.setPath('appData', ${JSON.stringify(scratchDirectory)});
app.setPath('userData', ${JSON.stringify(isolatedUserDataDirectory)});
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('ready', () => log('app-ready'));
app.on('browser-window-created', (_event, window) => {
  const webContents = window.webContents;
  const originalGetMediaSourceId = webContents.getMediaSourceId.bind(webContents);
  webContents.getMediaSourceId = (requester) => {
    const mediaSourceId = originalGetMediaSourceId(requester);
    log('media-source-id ' + JSON.stringify({ sourceUrl: webContents.getURL(), sourceWebContentsId: webContents.id, requesterWebContentsId: requester?.id ?? null, mediaSourceId }));
    return mediaSourceId;
  };
  log('browser-window-created ' + webContents.getURL());
});
app.on('window-all-closed', () => log('window-all-closed'));
log('paths-before-main ' + JSON.stringify({ appDataIsolated: app.getPath('appData').startsWith(${JSON.stringify(scratchDirectory)}), userDataIsolated: app.getPath('userData').startsWith(${JSON.stringify(scratchDirectory)}) }));
log('requiring-main-before-ready');
require(${JSON.stringify(mainPath)});
log('required-main');
`;
  await fs.writeFile(bootstrapPath, bootstrap, 'utf8');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  console.log(`Launching Stream with Electron ${electronVersion} (${electronBinary}).`);
  app = await electron.launch({ executablePath: electronBinary, args: [bootstrapPath], cwd: streamWorkingDirectory, env, timeout: 60_000 });
  app.on('window', (window) => {
    window.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`));
    window.on('pageerror', (error) => console.error(`[renderer:error] ${error.stack ?? error}`));
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate((seconds) => {
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints) => {
        const stream = await originalGetUserMedia(constraints);
        if (constraints?.audio?.mandatory?.chromeMediaSource !== 'tab') return stream;

        const context = new AudioContext();
        await context.resume();
        const capture = {
          constraints,
          tracks: stream.getAudioTracks().map((track) => ({
            kind: track.kind,
            readyState: track.readyState,
            muted: track.muted,
            settings: track.getSettings(),
          })),
          sampleRate: context.sampleRate,
          targetFrames: Math.floor(context.sampleRate * seconds),
          frameCount: 0,
          chunks: [],
        };
        const input = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(4096, 2, 1);
        const silentOutput = context.createGain();
        silentOutput.gain.value = 0;
        processor.onaudioprocess = (event) => {
          const channel = event.inputBuffer.getChannelData(0);
          const count = Math.min(channel.length, capture.targetFrames - capture.frameCount);
          if (count <= 0) return;
          capture.chunks.push(Array.from(channel.subarray(0, count)));
          capture.frameCount += count;
        };
        input.connect(processor);
        processor.connect(silentOutput);
        silentOutput.connect(context.destination);
        window.__browserAudioIsolationCapture = capture;
        return stream;
      },
    });
  }, captureSeconds);

  const addBrowserSource = async (url) => {
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Browser Source', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await page.getByLabel('URL').fill(url);
    await page.getByRole('button', { name: 'Add Source', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };

  await addBrowserSource(youtubeUrl);
  await addBrowserSource(meetingUrl);
  await waitFor(
    'both BrowserSourceManager fixture pages to finish loading',
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.webContents.getURL())),
    (urls) => urls.includes(youtubeUrl) && urls.includes(meetingUrl),
  );
  const startedTones = await app.evaluate(async ({ BrowserWindow }, urls) => {
    const windows = BrowserWindow.getAllWindows();
    const states = [];
    for (const url of urls) {
      const sourceWindow = windows.find((window) => window.webContents.getURL() === url);
      if (!sourceWindow) throw new Error(`Missing test-owned source page: ${url}`);
      const tone = await sourceWindow.webContents.executeJavaScript('window.startTone()');
      states.push({ ...tone, windowVisible: sourceWindow.isVisible(), windowMuted: sourceWindow.webContents.isAudioMuted() });
    }
    return states;
  }, [youtubeUrl, meetingUrl]);
  assert.equal(startedTones.length, 2);
  assert.deepEqual(startedTones.map((tone) => tone.frequencyHz), [selectedFrequencyHz, otherFrequencyHz]);

  const youtubeRow = page.getByRole('treeitem').filter({ hasText: 'localhost' }).first();
  await youtubeRow.waitFor({ state: 'visible' });
  const treeRows = await page.getByRole('treeitem').evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ''));
  await youtubeRow.dispatchEvent('contextmenu', { button: 2 });
  await page.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  const captureAudio = page.getByRole('checkbox', { name: 'Capture Audio', exact: true });
  await captureAudio.waitFor({ state: 'visible' });
  if (!(await captureAudio.isChecked())) await captureAudio.click();

  const captureMetadata = await waitFor(
    'Browser Source GUM capture and PCM',
    () => page.evaluate(() => {
      const capture = window.__browserAudioIsolationCapture;
      return capture ? {
        constraints: capture.constraints,
        tracks: capture.tracks,
        sampleRate: capture.sampleRate,
        frameCount: capture.frameCount,
      } : null;
    }),
    (capture) => Boolean(capture && capture.frameCount >= capture.sampleRate * 2),
    30_000,
  );

  const capturedPcm = await page.evaluate(() => {
    const capture = window.__browserAudioIsolationCapture;
    return {
      sampleRate: capture.sampleRate,
      samples: capture.chunks.flat(),
      constraints: capture.constraints,
      tracks: capture.tracks,
    };
  });
  const pcm = Float32Array.from(capturedPcm.samples);
  const analysisFrames = Math.min(pcm.length, Math.floor(capturedPcm.sampleRate * 2));
  const analysisSamples = pcm.subarray(0, analysisFrames);
  const measuredSelected = goertzelAmplitude(analysisSamples, capturedPcm.sampleRate, selectedFrequencyHz);
  const measuredOther = goertzelAmplitude(analysisSamples, capturedPcm.sampleRate, otherFrequencyHz);
  const selectedToOtherDb = Number((measuredSelected.levelDbfs - measuredOther.levelDbfs).toFixed(2));

  const sourceInventory = await app.evaluate(({ BrowserWindow }, urls) => {
    const windows = BrowserWindow.getAllWindows();
    const requester = windows.find((window) => window.webContents.getURL().includes('/renderer/index.html'));
    if (!requester) throw new Error('The Stream renderer WebContents was not found.');
    const sources = urls.map((url) => {
      const sourceWindow = windows.find((window) => window.webContents.getURL() === url);
      if (!sourceWindow) throw new Error(`Missing test-owned source page: ${url}`);
      return { url, webContentsId: sourceWindow.webContents.id };
    });
    return { requesterWebContentsId: requester.webContents.id, sources };
  }, [youtubeUrl, meetingUrl]);
  const sourceIds = sourceInventory.sources;

  const requestedMediaSourceId = capturedPcm.constraints?.audio?.mandatory?.chromeMediaSourceId ?? null;
  const startupLog = await fs.readFile(startupLogPath, 'utf8');
  const startupLines = startupLog.split(/\r?\n/);
  const isolationLine = startupLines.find((line) => line.startsWith('paths-before-main '));
  const bootstrapIsolation = isolationLine ? JSON.parse(isolationLine.slice('paths-before-main '.length)) : null;
  const sourceIdCalls = startupLines
    .filter((line) => line.startsWith('media-source-id '))
    .map((line) => JSON.parse(line.slice('media-source-id '.length)));
  const matchingSourceIdCall = sourceIdCalls.find((call) => call.mediaSourceId === requestedMediaSourceId) ?? null;
  const selectedSource = sourceIds.find((source) => source.webContentsId === matchingSourceIdCall?.sourceWebContentsId) ?? null;
  const sourceIdWasRequestedByMain = matchingSourceIdCall?.requesterWebContentsId === sourceInventory.requesterWebContentsId;
  const liveAudioTracks = capturedPcm.tracks.filter((track) => track.readyState === 'live').length;
  const passed = Boolean(
    bootstrapIsolation?.appDataIsolated === true
    && bootstrapIsolation?.userDataIsolated === true
    && matchingSourceIdCall !== null
    && sourceIdWasRequestedByMain
    && selectedSource?.url === youtubeUrl
    && liveAudioTracks > 0
    && analysisFrames >= capturedPcm.sampleRate * 2
    && measuredSelected.levelDbfs > -40
    && measuredOther.levelDbfs < measuredSelected.levelDbfs - 35,
  );
  outcome = {
    passed,
    platform: process.platform,
    electronVersion,
    electronBinary,
    fixtureUrls: { youtube: youtubeUrl, meeting: meetingUrl },
    generatedTones: startedTones,
    bootstrapIsolation,
    sourceRows: treeRows,
    sourceWebContents: sourceIds,
    capture: {
      api: 'BrowserSourceManager.getAudioCaptureId -> selectedSource.webContents.getMediaSourceId(requester) -> renderer getUserMedia(chromeMediaSource: tab)',
      requestedMediaSourceId,
      matchingGetMediaSourceIdCall: matchingSourceIdCall,
      matchedSourceUrl: selectedSource?.url ?? null,
      liveAudioTracks,
      sampleRate: capturedPcm.sampleRate,
      pcmFrames: pcm.length,
      analyzedSeconds: Number((analysisFrames / capturedPcm.sampleRate).toFixed(3)),
      selectedTone: measuredSelected,
      otherTone: measuredOther,
      selectedToOtherDb,
    },
    assertions: {
      requestedSourceWasYouTube440Hz: selectedSource?.url === youtubeUrl,
      getMediaSourceIdCallMatchedGumConstraint: matchingSourceIdCall !== null,
      mediaSourceIdWasRequestedByMainRenderer: sourceIdWasRequestedByMain,
      liveAudioTrack: liveAudioTracks > 0,
      selected440HzAboveMinus40Dbfs: measuredSelected.levelDbfs > -40,
      meeting660HzAtLeast35DbBelowSelected: measuredOther.levelDbfs < measuredSelected.levelDbfs - 35,
    },
    limitations: ['One macOS host; this verifies Stream Browser Source WebContents capture, not arbitrary external Chrome window capture.'],
  };
  await fs.writeFile(resultPath, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(outcome, null, 2));
  assert.equal(passed, true, `Browser-source isolation did not pass. Evidence: ${resultPath}`);
} catch (error) {
  primaryError = error;
  if (!outcome) {
    outcome = {
      passed: false,
      platform: process.platform,
      electronVersion,
      electronBinary,
      error: String(error),
    };
    await fs.writeFile(resultPath, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
  }
  throw error;
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (app) {
    const child = app.process();
    let timer;
    await Promise.race([app.close(), new Promise((resolve) => { timer = setTimeout(() => { child.kill(); resolve(); }, 5_000); })]);
    clearTimeout(timer);
  }
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  if (primaryError) console.error(`Browser audio isolation failed; sanitized evidence: ${resultPath}`);
}

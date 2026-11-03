import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const appRequire = createRequire(path.resolve('apps/stream/package.json'));
const playwrightRequire = createRequire(path.resolve('package.json'));
const { _electron: electron, expect } = playwrightRequire('@playwright/test');
const sharp = appRequire('sharp');
const electronPackagePath = appRequire.resolve('electron/package.json');
const electronPackage = appRequire(electronPackagePath);
const electronBinary = appRequire('electron');

const outputRoot = path.resolve('output/playwright/continuity-e2e');
const presentationFixtureRoot = path.join(outputRoot, 'fixtures');
const fixtureIds = {
  slideshow: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'],
  pptx: ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003'],
  pdf: ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003'],
  video: '40000000-0000-4000-8000-000000000001',
  audio: '50000000-0000-4000-8000-000000000001',
};

function uuid() { return crypto.randomUUID(); }

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksumInput = Buffer.concat([typeBytes, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(checksumInput));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function createSolidPng(width, height, [red, green, blue]) {
  const rowLength = width * 3 + 1;
  const pixels = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * rowLength;
    for (let x = 0; x < width; x += 1) {
      const offset = start + 1 + x * 3;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createSineWaveWav(durationSeconds = 15, sampleRate = 48000) {
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.floor(durationSeconds * sampleRate);
  const dataLength = sampleCount * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataLength);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataLength, 40);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = Math.round(Math.sin(2 * Math.PI * 440 * sample / sampleRate) * 0.2 * 32767);
    wav.writeInt16LE(value, 44 + sample * bytesPerSample);
  }
  return wav;
}

function makeSource(name, kind, transform, extras = {}) {
  return {
    id: uuid(), name, kind, visible: true, muted: false, volume: 1,
    transform, ...extras,
  };
}

function makeProject(browserUrl) {
  const bounds = {
    slideshow: { x: 0, y: 0, width: 480, height: 270 },
    pptx: { x: 480, y: 0, width: 480, height: 270 },
    pdf: { x: 960, y: 0, width: 480, height: 270 },
    video: { x: 0, y: 270, width: 480, height: 270 },
    browser: { x: 480, y: 270, width: 640, height: 360 },
    audio: { x: 0, y: 0, width: 1, height: 1 },
  };
  const slideAssets = (family, names) => fixtureIds[family].map((assetId, index) => ({
    assetId, assetExtension: 'png', name: names[index],
  }));
  const sceneSources = (suffix) => [
    makeSource(`Image Slideshow ${suffix}`, 'slideshow', bounds.slideshow, {
      slideshowImages: slideAssets('slideshow', ['Red', 'Green', 'Blue']),
      slideshowAutoAdvance: false, slideshowLoop: true, slideIndex: 0,
    }),
    makeSource(`PPTX Deck ${suffix}`, 'presentation', bounds.pptx, {
      presentationSlides: slideAssets('pptx', ['PPTX Page 1', 'PPTX Page 2', 'PPTX Page 3']), slideIndex: 0,
    }),
    makeSource(`PDF Deck ${suffix}`, 'presentation', bounds.pdf, {
      presentationSlides: slideAssets('pdf', ['PDF Page 1', 'PDF Page 2', 'PDF Page 3']), slideIndex: 0,
    }),
    makeSource(`Moving Video ${suffix}`, 'media', bounds.video, {
      assetId: fixtureIds.video, assetExtension: 'webm', mediaKind: 'video', loop: true,
      restartPlaybackWhenActive: true, showNothingWhenPlaybackEnds: false,
    }),
    makeSource(`Audio Bed ${suffix}`, 'media', bounds.audio, {
      assetId: fixtureIds.audio, assetExtension: 'wav', mediaKind: 'audio', loop: true,
      restartPlaybackWhenActive: false,
    }),
    makeSource(`Browser State ${suffix}`, 'browser', bounds.browser, {
      url: browserUrl, browserAudioEnabled: false,
    }),
  ];
  const sceneA = { id: 'continuity-scene-a', name: 'Continuity A', sources: sceneSources('A') };
  const sceneB = { id: 'continuity-scene-b', name: 'Continuity B', sources: sceneSources('B') };
  const empty = { id: 'continuity-scene-empty', name: 'Empty Scene', sources: [] };
  return {
    version: 1,
    output: {
      baseWidth: 1920, baseHeight: 1080, width: 1920, height: 1080, frameRate: 30,
      streamVideoBitrateKbps: 6000, streamAudioBitrateKbps: 160, streamAudioTrack: 1,
      streamRateControl: 'cbr', streamVideoEncoder: 'libopenh264', streamEncoderQuality: 60,
      streamHardwareEncoding: false, streamKeyframeIntervalSeconds: 2,
      recordingVideoBitrateKbps: 8000, recordingAudioBitrateKbps: 160, recordingAudioTracks: [1],
      recordingContainer: 'webm', recordingRateControl: 'cbr', recordingVideoEncoder: 'libopenh264',
      recordingEncoderQuality: 60, recordingHardwareEncoding: false, recordingKeyframeIntervalSeconds: 2,
    },
    studioMode: true,
    activeSceneId: sceneA.id,
    liveSceneId: sceneA.id,
    hotkeys: {
      toggleStreaming: 'Control+Alt+F9', toggleRecording: 'Control+Alt+F10',
      toggleReplayBuffer: 'Control+Alt+F11', saveReplay: 'Control+Alt+F12',
    },
    sceneSwitchHotkeys: {}, sourceVisibilityHotkeys: {}, scenes: [sceneA, sceneB, empty],
  };
}

function browserFixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Local Browser Continuity Fixture</title>
  <style>html,body{margin:0;width:100%;min-height:2200px;background:#203b74;color:white;font:20px sans-serif}main{padding:24px}label{display:block;margin:14px 0}input{font:20px sans-serif;width:250px;padding:8px}button{font:20px sans-serif;padding:10px 18px}#count{font-weight:bold}#scroll-marker{position:absolute;top:1980px;left:24px}</style></head>
  <body><main><strong>Local Browser Continuity Fixture</strong><label>State<input id="state-input" aria-label="State" value=""></label>
  <button id="increment" type="button">Increment <span id="count">0</span></button><div id="scroll-marker">Scroll marker</div></main>
  <script>
    const send=(type)=>fetch('/telemetry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,value:document.querySelector('#state-input').value,count:Number(document.querySelector('#count').textContent),scrollY:window.scrollY})}).catch(()=>{});
    document.addEventListener('DOMContentLoaded',()=>send('load'));
    document.querySelector('#state-input').addEventListener('input',()=>send('input'));
    document.querySelector('#increment').addEventListener('click',()=>{const node=document.querySelector('#count');node.textContent=String(Number(node.textContent)+1);send('click')});
    let scrollTimer;window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>send('scroll'),50)},{passive:true});
  </script></body></html>`;
}

async function listenOnLoopback(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function freePort() {
  const server = net.createServer();
  const port = await listenOnLoopback(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function makeMediaFixtures(outputDir) {
  const generatorData = path.join(outputDir, '.media-generator-data');
  const generatorBootstrap = path.join(outputDir, 'media-generator-bootstrap.cjs');
  await fs.writeFile(generatorBootstrap, `const {app,BrowserWindow}=require('electron');app.setPath('appData',${JSON.stringify(generatorData)});app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:640,height:360,webPreferences:{contextIsolation:true,nodeIntegration:false}});window.webContents.setBackgroundThrottling(false);window.webContents.setFrameRate(30);window.loadURL('about:blank');});`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const generator = await electron.launch({
    executablePath: electronBinary,
    args: ['--autoplay-policy=no-user-gesture-required', generatorBootstrap],
    env,
    timeout: 30000,
  });
  try {
    const page = await generator.firstWindow();
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    const fixture = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext('2d');
      if (!context || !canvas.captureStream || !window.MediaRecorder) throw new Error('MediaRecorder fixture generation is unavailable.');
      const videoStream = canvas.captureStream(20);
      const videoMimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
      if (!videoMimeType) throw new Error('This Chromium build has no supported WebM MediaRecorder codec.');
      const videoPromise = new Promise((resolve, reject) => {
        const recorder = new MediaRecorder(videoStream, { mimeType: videoMimeType });
        const chunks = [];
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = (event) => reject(event.error ?? new Error('MediaRecorder failed.'));
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: videoMimeType });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          resolve({ mimeType: blob.type, base64: btoa(binary), byteLength: blob.size });
        };
        recorder.start(250);
        setTimeout(() => recorder.stop(), 15000);
      });
      let frame = 0;
      const draw = () => {
        const colors = ['#e05a45', '#26a6a1', '#5e75dc'];
        context.fillStyle = colors[Math.floor(frame / 40) % colors.length];
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.font = '48px sans-serif';
        context.fillText('Synthetic media ' + frame, 40, 90);
        frame += 1;
        requestAnimationFrame(draw);
      };
      draw();
      const video = await videoPromise;
      return { video, durationSeconds: 15 };
    });
    await fs.writeFile(path.join(outputDir, 'synthetic-video.webm'), Buffer.from(fixture.video.base64, 'base64'));
    const audio = createSineWaveWav(fixture.durationSeconds);
    await fs.writeFile(path.join(outputDir, 'synthetic-audio.wav'), audio);
    return {
      videoBytes: fixture.video.byteLength, audioBytes: audio.byteLength,
      durationSeconds: fixture.durationSeconds, mimeType: fixture.video.mimeType,
    };
  } finally {
    const child = generator.process();
    let timer;
    try {
      await Promise.race([generator.close().catch(() => undefined), new Promise((resolve) => { timer = setTimeout(() => { child.kill(); resolve(); }, 5000); })]);
    } finally {
      clearTimeout(timer);
      await fs.rm(generatorData, { recursive: true, force: true });
    }
  }
}

async function seedFixture(runRoot, browserUrl) {
  await fs.mkdir(presentationFixtureRoot, { recursive: true });
  const requiredPages = [
    'slide-1.png', 'slide-2.png', 'slide-3.png',
    'pdf-page-1.png', 'pdf-page-2.png', 'pdf-page-3.png',
  ];
  for (const file of requiredPages) await fs.access(path.join(presentationFixtureRoot, file));
  await fs.copyFile(path.join(presentationFixtureRoot, 'deck.pptx'), path.join(runRoot, 'deck.pptx'));
  await fs.copyFile(path.join(presentationFixtureRoot, 'deck.pdf'), path.join(runRoot, 'deck.pdf'));
  for (const [index, id] of fixtureIds.slideshow.entries()) {
    const colors = [[220, 50, 50], [40, 185, 90], [45, 90, 220]];
    await fs.writeFile(path.join(runRoot, `${id}.png`), createSolidPng(640, 360, colors[index]));
  }
  const media = await makeMediaFixtures(runRoot);
  const mediaDirectory = path.join(runRoot, 'app-data', 'LumaStream', 'media');
  const collectionDirectory = path.join(runRoot, 'app-data', 'LumaStream', 'scene-collections');
  await fs.mkdir(mediaDirectory, { recursive: true });
  await fs.mkdir(collectionDirectory, { recursive: true });
  for (let index = 0; index < fixtureIds.pptx.length; index += 1) {
    await fs.copyFile(path.join(presentationFixtureRoot, `slide-${index + 1}.png`), path.join(mediaDirectory, `${fixtureIds.pptx[index]}.png`));
    await fs.copyFile(path.join(presentationFixtureRoot, `pdf-page-${index + 1}.png`), path.join(mediaDirectory, `${fixtureIds.pdf[index]}.png`));
  }
  for (const id of fixtureIds.slideshow) {
    await fs.copyFile(path.join(runRoot, `${id}.png`), path.join(mediaDirectory, `${id}.png`));
  }
  await fs.copyFile(path.join(runRoot, 'synthetic-video.webm'), path.join(mediaDirectory, `${fixtureIds.video}.webm`));
  await fs.copyFile(path.join(runRoot, 'synthetic-audio.wav'), path.join(mediaDirectory, `${fixtureIds.audio}.wav`));
  const collectionId = uuid();
  const project = makeProject(browserUrl);
  await fs.writeFile(path.join(collectionDirectory, 'index.json'), JSON.stringify({
    version: 1, activeCollectionId: collectionId, collections: [{ id: collectionId, name: 'Continuity Fixture' }],
  }, null, 2));
  await fs.writeFile(path.join(collectionDirectory, `${collectionId}.json`), JSON.stringify(project, null, 2));
  return {
    collectionId,
    projectPath: path.join(collectionDirectory, `${collectionId}.json`),
    media: {
      slideshowPages: fixtureIds.slideshow.length,
      pptxPages: fixtureIds.pptx.length,
      pdfPages: fixtureIds.pdf.length,
      ...media,
    },
  };
}

function createBrowserFixtureServer() {
  const telemetry = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/fixture' && request.method === 'GET') {
      telemetry.push({ type: 'request', at: Date.now(), path: request.url });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(browserFixtureHtml());
      return;
    }
    if (request.url === '/telemetry' && request.method === 'POST') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        try { telemetry.push({ ...JSON.parse(Buffer.concat(chunks).toString('utf8')), typeAtServer: Date.now() }); }
        catch (error) { telemetry.push({ type: 'invalid-telemetry', error: String(error) }); }
        response.writeHead(204);
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  return { server, telemetry };
}

async function stageSurfaceBounds(page, label) {
  const panel = page.locator('.stage-panel').filter({ has: page.getByText(label, { exact: true }) }).first();
  const bounds = await panel.locator('.stage-surface').boundingBox();
  if (!bounds) throw new Error(`No ${label} stage surface is visible.`);
  return bounds;
}

function stageClip(bounds, x, y, width, height) {
  return {
    x: bounds.x + x / 1920 * bounds.width,
    y: bounds.y + y / 1080 * bounds.height,
    width: width / 1920 * bounds.width,
    height: height / 1080 * bounds.height,
  };
}

async function sampleStagePixel(page, label, x, y) {
  const bounds = await stageSurfaceBounds(page, label);
  const clip = stageClip(bounds, x - 3, y - 3, 7, 7);
  const screenshot = await page.screenshot({ clip });
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2], 255];
}

async function expectStageRgb(page, label, x, y, expected, timeout = 5000) {
  await expect.poll(async () => {
    const actual = await sampleStagePixel(page, label, x, y);
    const distance = actual.slice(0, 3).reduce((total, value, index) => total + Math.abs(value - expected[index]), 0);
    return distance <= 12;
  }, { timeout }).toBe(true);
}

async function stageSignatures(page, label, regions) {
  const bounds = await stageSurfaceBounds(page, label);
  const signatures = {};
  for (const { name, x, y, width, height } of regions) {
    const screenshot = await page.screenshot({ clip: stageClip(bounds, x, y, width, height) });
    const data = await sharp(screenshot).resize(32, 18, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    let hash = 2166136261;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    signatures[name] = (hash >>> 0).toString(16);
  }
  return signatures;
}

async function mediaTimes(page) {
  return page.evaluate(() => {
    let nextNodeId = Number(window.__continuityMediaNodeSequence ?? 0);
    const entries = [...document.querySelectorAll('[data-stage-runtime-source]')]
      .filter((element) => element instanceof HTMLMediaElement)
      .map((element) => {
        if (!element.dataset.continuityMediaNode) {
          nextNodeId += 1;
          element.dataset.continuityMediaNode = `media-node-${nextNodeId}`;
        }
        return [`${element.tagName.toLowerCase()}:${element.dataset.stageRuntimeSource}`, {
          currentTime: element.currentTime, paused: element.paused, muted: element.muted,
          readyState: element.readyState, duration: element.duration,
          runtimeId: element.dataset.stageRuntimeSource, originId: element.dataset.stageSource,
          nodeId: element.dataset.continuityMediaNode,
        }];
      });
    window.__continuityMediaNodeSequence = nextNodeId;
    return Object.fromEntries(entries);
  });
}

function hasAdvanced(current, previous, duration, minimum = 0.3) {
  if (duration > 0 && Number.isFinite(duration)) return ((current - previous + duration) % duration) > minimum;
  return current > previous + minimum;
}

async function snapshotBrowserSessions(app, browserUrl) {
  return app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().map((window) => ({
    visible: window.isVisible(), destroyed: window.isDestroyed(), url: window.webContents.getURL(),
  })).filter((window) => window.url.startsWith(url) || window.visible), browserUrl);
}

async function inspectBrowserFixture(app, browserUrl) {
  return app.evaluate(async ({ BrowserWindow }, url) => {
    const browserWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith(url));
    if (!browserWindow) return null;
    return browserWindow.webContents.executeJavaScript(`(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        input: rect('#state-input'), button: rect('#increment'),
        value: document.querySelector('#state-input')?.value ?? null,
        count: Number(document.querySelector('#count')?.textContent ?? 0),
        activeElement: document.activeElement?.id ?? document.activeElement?.tagName ?? null,
      };
    })()`);
  }, browserUrl);
}

async function selectScene(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.stage-panel').filter({ has: page.getByText(name, { exact: true }) }).first()).toBeVisible();
}

async function selectProgramSlides(page, name) {
  const combobox = page.getByRole('combobox', { name: 'Slide source' });
  await combobox.click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('status', { name: /Slide [1-3] of 3/ })).toBeVisible();
}

async function openProperties(page, sourceName) {
  await page.getByRole('treeitem').filter({ hasText: sourceName }).click();
  await page.getByRole('button', { name: 'More source actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Source Properties' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(sourceName, { exact: true })).toBeVisible();
}

async function closeProperties(page) {
  const dialog = page.getByRole('dialog', { name: 'Source Properties' });
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function main() {
  if (electronPackage.version !== '44.3.0' || !electronPackagePath.startsWith(path.resolve('apps/stream/node_modules/electron'))) {
    throw new Error(`Expected Stream's Electron 44.3.0 package, resolved ${electronPackage.version} at ${electronPackagePath}`);
  }
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const runRoot = path.join(outputRoot, `run-${stamp}-${process.pid}`);
  await fs.mkdir(runRoot, { recursive: true });

  const { server, telemetry } = createBrowserFixtureServer();
  const browserPort = await listenOnLoopback(server);
  server.unref();
  const browserUrl = `http://127.0.0.1:${browserPort}/fixture`;
  const debugPort = await freePort();
  const fixture = await seedFixture(runRoot, browserUrl);
  const bootstrap = path.join(runRoot, 'bootstrap.cjs');
  await fs.writeFile(bootstrap, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(path.join(runRoot, 'app-data'))});require(${JSON.stringify(path.resolve('apps/stream/out/main/index.js'))});`);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [`--remote-debugging-port=${debugPort}`, '--autoplay-policy=no-user-gesture-required', bootstrap],
    env,
    timeout: 30000,
  });
  const rendererErrors = [];
  const checks = [];
  let page;

  try {
    page = await app.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push({ kind: 'pageerror', message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push({ kind: 'console', message: message.text() });
    });
    await page.getByRole('button', { name: 'Transition scene', exact: true }).waitFor({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Continuity A', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(runRoot, 'startup.png') });

    const imageRegions = [
      { name: 'slideshow', x: 0, y: 0, width: 480, height: 270 },
      { name: 'pptx', x: 480, y: 0, width: 480, height: 270 },
      { name: 'pdf', x: 960, y: 0, width: 480, height: 270 },
    ];
    await expectStageRgb(page, 'PREVIEW', 240, 135, [220, 50, 50], 15000);
    await expectStageRgb(page, 'PROGRAM', 240, 135, [220, 50, 50], 15000);
    checks.push('seeded slideshow, PPTX, and PDF pages render in Preview and Program');

    fixture.programCanvasCaptureStream = await page.evaluate(() => {
      const canvas = document.querySelector('.program-panel canvas.composition-canvas');
      if (!canvas) return { ok: false, error: 'Program composition canvas is missing.' };
      try {
        const stream = canvas.captureStream(30);
        const videoTracks = stream.getVideoTracks().length;
        stream.getTracks().forEach((track) => track.stop());
        return { ok: videoTracks > 0, videoTracks };
      } catch (error) {
        return { ok: false, name: error instanceof DOMException ? error.name : 'Error', error: String(error) };
      }
    });
    if (!fixture.programCanvasCaptureStream.ok) {
      throw new Error(`Program canvas captureStream(30) failed: ${JSON.stringify(fixture.programCanvasCaptureStream)}`);
    }
    checks.push('Program canvas captureStream(30) returns a video track with loaded managed-media fixtures');

    await expect.poll(() => mediaTimes(page).then((times) => Object.values(times).filter((item) => item.readyState >= 2).length), { timeout: 20000 }).toBe(2);
    await expect.poll(() => telemetry.filter((event) => event.path === '/fixture').length, { timeout: 15000 }).toBe(1);
    await expect.poll(() => telemetry.some((event) => event.type === 'load'), { timeout: 15000 }).toBe(true);
    const stageSessionCounts = await page.locator('[data-stage-runtime-source]').evaluateAll((nodes) => ({
      video: nodes.filter((node) => node instanceof HTMLVideoElement).length,
      audio: nodes.filter((node) => node instanceof HTMLAudioElement).length,
      runtimeIds: nodes.map((node) => node.dataset.stageRuntimeSource),
    }));
    assert.deepEqual({ video: stageSessionCounts.video, audio: stageSessionCounts.audio }, { video: 1, audio: 1 });
    const browserSessions = await snapshotBrowserSessions(app, browserUrl);
    assert.equal(browserSessions.length, 2, `Expected one app window and one browser-source page; saw ${JSON.stringify(browserSessions)}`);
    checks.push('one media player per video/audio session and one offscreen browser page per matching source');

    await selectProgramSlides(page, 'Image Slideshow A');
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Slide 2 of 3' })).toBeVisible();
    await expectStageRgb(page, 'PREVIEW', 240, 135, [40, 185, 90]);
    await expectStageRgb(page, 'PROGRAM', 240, 135, [40, 185, 90]);
    await page.getByRole('button', { name: 'Previous slide', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Slide 1 of 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Slide 3 of 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset slides', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Slide 1 of 3' })).toBeVisible();
    await expectStageRgb(page, 'PREVIEW', 240, 135, [220, 50, 50]);
    await expectStageRgb(page, 'PROGRAM', 240, 135, [220, 50, 50]);
    await page.screenshot({ path: path.join(runRoot, 'slides-reset.png') });
    checks.push('Next, Previous, and Reset update matching Preview and Program slideshow frames immediately');

    for (const sourceName of ['PPTX Deck A', 'PDF Deck A']) {
      await selectProgramSlides(page, sourceName);
      const before = await stageSignatures(page, 'PROGRAM', imageRegions);
      const previewBefore = await stageSignatures(page, 'PREVIEW', imageRegions);
      await page.getByRole('button', { name: 'Next slide', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Slide 2 of 3' })).toBeVisible();
      await expect.poll(() => stageSignatures(page, 'PROGRAM', imageRegions).then((value) => value[sourceName.startsWith('PPTX') ? 'pptx' : 'pdf']), { timeout: 5000 }).not.toBe(before[sourceName.startsWith('PPTX') ? 'pptx' : 'pdf']);
      await expect.poll(() => stageSignatures(page, 'PREVIEW', imageRegions).then((value) => value[sourceName.startsWith('PPTX') ? 'pptx' : 'pdf']), { timeout: 5000 }).not.toBe(previewBefore[sourceName.startsWith('PPTX') ? 'pptx' : 'pdf']);
      await page.getByRole('button', { name: 'Previous slide', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Slide 1 of 3' })).toBeVisible();
      await page.getByRole('button', { name: 'Next slide', exact: true }).click();
      await page.getByRole('button', { name: 'Next slide', exact: true }).click();
      await page.getByRole('button', { name: 'Reset slides', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Slide 1 of 3' })).toBeVisible();
      const region = sourceName.startsWith('PPTX') ? 'pptx' : 'pdf';
      await expect.poll(() => stageSignatures(page, 'PROGRAM', imageRegions).then((value) => value[region]), { timeout: 5000 }).toBe(before[region]);
      await expect.poll(() => stageSignatures(page, 'PREVIEW', imageRegions).then((value) => value[region]), { timeout: 5000 }).toBe(previewBefore[region]);
    }
    checks.push('Next, Previous, and Reset update matching PPTX and PDF presentation pages');

    await selectProgramSlides(page, 'Image Slideshow A');
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Slide 2 of 3' })).toBeVisible();
    const initialVideoTimes = await mediaTimes(page);
    const videoKey = Object.keys(initialVideoTimes).find((key) => key.startsWith('video:'));
    const audioKey = Object.keys(initialVideoTimes).find((key) => key.startsWith('audio:'));
    assert.ok(videoKey && audioKey, `Expected active video and audio elements: ${JSON.stringify(initialVideoTimes)}`);
    await expect.poll(() => mediaTimes(page).then((times) => times[videoKey]?.currentTime ?? 0), { timeout: 10000 }).toBeGreaterThan(0.7);

    const originalWorkspace = await page.evaluate(() => window.streamApi.loadProject());
    const originalVideoSource = originalWorkspace.project.scenes.flatMap((scene) => scene.sources).find((source) => source.name === 'Moving Video A');
    const originalAudioSource = originalWorkspace.project.scenes.flatMap((scene) => scene.sources).find((source) => source.name === 'Audio Bed A');
    assert.ok(originalVideoSource && originalAudioSource, 'Could not read the initial video/audio sources from the active workspace.');
    const mediaBeforeCollectionSwitch = await mediaTimes(page);
    const videoNodeBeforeCollectionSwitch = mediaBeforeCollectionSwitch[videoKey].nodeId;
    const audioNodeBeforeCollectionSwitch = mediaBeforeCollectionSwitch[audioKey].nodeId;
    await app.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find((window) => window.isVisible());
      if (!mainWindow) throw new Error('Visible Stream window was not available for native menu action dispatch.');
      mainWindow.webContents.send('stream:menu-action', 'sceneCollection.duplicate');
    });
    await expect(page.getByRole('dialog', { name: 'Duplicate Collection' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Name' }).fill('Continuity Fixture Copy');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.streamApi.loadProject().then((workspace) => workspace.activeCollectionId)), { timeout: 10000 }).not.toBe(originalWorkspace.activeCollectionId);
    const duplicateWorkspace = await page.evaluate(() => window.streamApi.loadProject());
    const duplicatedVideoSource = duplicateWorkspace.project.scenes.flatMap((scene) => scene.sources).find((source) => source.name === 'Moving Video A');
    const duplicatedAudioSource = duplicateWorkspace.project.scenes.flatMap((scene) => scene.sources).find((source) => source.name === 'Audio Bed A');
    assert.ok(duplicatedVideoSource && duplicatedAudioSource, 'Duplicated collection lost the seeded video/audio sources.');
    assert.notEqual(duplicatedVideoSource.id, originalVideoSource.id, 'Duplicated collection should have new logical source IDs.');
    assert.notEqual(duplicatedAudioSource.id, originalAudioSource.id, 'Duplicated collection should have new logical source IDs.');
    assert.equal(duplicatedVideoSource.assetId, originalVideoSource.assetId, 'Duplicated video should keep the same asset.');
    assert.equal(duplicatedAudioSource.assetId, originalAudioSource.assetId, 'Duplicated audio should keep the same asset.');
    await expect.poll(() => mediaTimes(page).then((times) => times[videoKey]?.nodeId !== videoNodeBeforeCollectionSwitch
      && times[audioKey]?.nodeId !== audioNodeBeforeCollectionSwitch), { timeout: 10000 }).toBe(true);
    await expect.poll(() => mediaTimes(page).then((times) => times[videoKey]?.muted === false && times[audioKey]?.muted === false), { timeout: 10000 }).toBe(true);
    const mediaAfterCollectionSwitch = await mediaTimes(page);
    assert.equal(mediaAfterCollectionSwitch[videoKey].runtimeId, mediaBeforeCollectionSwitch[videoKey].runtimeId, 'Video runtime ID changed across a duplicate workspace switch despite matching asset configuration.');
    assert.equal(mediaAfterCollectionSwitch[audioKey].runtimeId, mediaBeforeCollectionSwitch[audioKey].runtimeId, 'Audio runtime ID changed across a duplicate workspace switch despite matching asset configuration.');
    await expect(page.locator('.mixer-strip-name', { hasText: 'Audio Bed A' })).toBeVisible();
    await expect(page.locator('.mixer-strip-name', { hasText: 'Moving Video A' })).toBeVisible();
    await expect.poll(() => mediaTimes(page).then((times) => hasAdvanced(
      times[audioKey]?.currentTime ?? 0,
      mediaAfterCollectionSwitch[audioKey].currentTime,
      times[audioKey]?.duration ?? 0,
    )), { timeout: 5000 }).toBe(true);
    checks.push('duplicating the active collection preserves canonical media IDs, remounts its players, and reconnects both audio mixer routes');

    await selectProgramSlides(page, 'Image Slideshow A');
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Slide 2 of 3' })).toBeVisible();
    await expectStageRgb(page, 'PREVIEW', 240, 135, [40, 185, 90]);
    await expectStageRgb(page, 'PROGRAM', 240, 135, [40, 185, 90]);

    const beforeMatchingTransition = await mediaTimes(page);
    await selectScene(page, 'Continuity B');
    await expect.poll(() => mediaTimes(page).then((times) => hasAdvanced(
      times[videoKey]?.currentTime ?? 0,
      beforeMatchingTransition[videoKey].currentTime,
      times[videoKey]?.duration ?? 0,
    )), { timeout: 5000 }).toBe(true);
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await expect(page.locator('.stage-panel').filter({ has: page.getByText('Continuity B', { exact: true }) })).toHaveCount(2);
    await expectStageRgb(page, 'PROGRAM', 240, 135, [40, 185, 90]);
    await expect.poll(() => mediaTimes(page).then((times) => hasAdvanced(
      times[videoKey]?.currentTime ?? 0,
      beforeMatchingTransition[videoKey].currentTime,
      times[videoKey]?.duration ?? 0,
    )), { timeout: 5000 }).toBe(true);
    await selectProgramSlides(page, 'Image Slideshow B');
    await expect(page.getByRole('status', { name: 'Slide 2 of 3' })).toBeVisible();
    await selectScene(page, 'Continuity A');
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await expectStageRgb(page, 'PROGRAM', 240, 135, [40, 185, 90]);
    await selectProgramSlides(page, 'Image Slideshow A');
    await expect(page.getByRole('status', { name: 'Slide 2 of 3' })).toBeVisible();
    checks.push('matching A→B→A transitions retain the current shared slideshow page and video timeline');

    for (const [sourceName, tag, key] of [['Moving Video A', 'video', videoKey], ['Audio Bed A', 'audio', audioKey]]) {
      await openProperties(page, sourceName);
      const propertiesDialog = page.getByRole('dialog', { name: 'Source Properties' });
      await propertiesDialog.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect.poll(() => mediaTimes(page).then((times) => times[key]?.paused), { timeout: 5000 }).toBe(true);
      const beforePause = (await mediaTimes(page))[key].currentTime;
      await page.waitForTimeout(600);
      const pausedTime = (await mediaTimes(page))[key].currentTime;
      assert.ok(Math.abs(pausedTime - beforePause) < 0.25, `${tag} advanced after Pause: ${beforePause} → ${pausedTime}`);
      await closeProperties(page);
      await selectScene(page, 'Continuity B');
      await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
      await expect.poll(() => mediaTimes(page).then((times) => times[key]?.paused), { timeout: 5000 }).toBe(true);
      await openProperties(page, sourceName.replace(/ A$/, ' B'));
      const resumedPropertiesDialog = page.getByRole('dialog', { name: 'Source Properties' });
      await expect(resumedPropertiesDialog.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
      await resumedPropertiesDialog.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(() => mediaTimes(page).then((times) => times[key]?.paused), { timeout: 5000 }).toBe(false);
      await expect.poll(() => mediaTimes(page).then((times) => hasAdvanced(
        times[key]?.currentTime ?? 0, pausedTime, times[key]?.duration ?? 0,
      )), { timeout: 5000 }).toBe(true);
      await closeProperties(page);
      await selectScene(page, 'Continuity A');
      await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
      await expect.poll(() => mediaTimes(page).then((times) => times[key]?.paused), { timeout: 5000 }).toBe(false);
      checks.push(`${tag} pause persists across matching scene transition and resumes from its current position`);
    }

    const videoBeforeEmpty = (await mediaTimes(page))[videoKey].currentTime;
    const audioBeforeEmpty = (await mediaTimes(page))[audioKey].currentTime;
    await selectScene(page, 'Empty Scene');
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await expect.poll(() => mediaTimes(page).then((times) => Object.values(times).length === 2 && Object.values(times).every((item) => item.paused)), { timeout: 5000 }).toBe(true);
    await selectScene(page, 'Continuity A');
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await expect.poll(() => mediaTimes(page).then((times) => times[videoKey]?.currentTime ?? 0), { timeout: 5000 }).toBeLessThan(1.2);
    const audioAfterReturn = (await mediaTimes(page))[audioKey].currentTime;
    const audioDuration = (await mediaTimes(page))[audioKey].duration;
    assert.ok(audioAfterReturn >= Math.max(0, audioBeforeEmpty - 0.25)
      || (audioDuration > 0 && audioBeforeEmpty > audioDuration - 1.2 && audioAfterReturn < 1.2),
    `Default audio playback restarted instead of resuming: ${audioBeforeEmpty} → ${audioAfterReturn}`);
    assert.ok(videoBeforeEmpty > 1.0, `Video had not advanced before the real inactive interval: ${videoBeforeEmpty}`);
    checks.push('opt-in video reset occurs after a real absent→present edge; default audio returns at its prior position');

    await openProperties(page, 'Browser State A');
    await closeProperties(page);
    const interactionButton = page.getByRole('button', { name: /interact.*browser|browser.*interact/i }).first();
    await interactionButton.waitFor({ state: 'visible', timeout: 10000 });
    await interactionButton.click();
    const interactionRegion = page.locator('.browser-interaction-region');
    await expect(interactionRegion).toBeVisible({ timeout: 5000 });
    const browserSourceBounds = { x: 480, y: 270, width: 640, height: 360 };
    const stageBounds = await page.locator('.stage-panel').filter({ has: page.getByText('PREVIEW', { exact: true }) }).locator('.stage-surface').boundingBox();
    assert.ok(stageBounds, 'Preview stage surface did not have a visible bounding box.');
    fixture.browserPageGeometry = await inspectBrowserFixture(app, browserUrl);
    assert.ok(fixture.browserPageGeometry?.input && fixture.browserPageGeometry?.button, 'Local browser fixture controls were not present in its page.');
    const sourcePoint = (x, y) => ({
      x: stageBounds.x + ((browserSourceBounds.x + x * browserSourceBounds.width) / 1920) * stageBounds.width,
      y: stageBounds.y + ((browserSourceBounds.y + y * browserSourceBounds.height) / 1080) * stageBounds.height,
    });
    const pagePoint = (rect) => ({
      x: (rect.x + rect.width / 2) / fixture.browserPageGeometry.viewport.width,
      y: (rect.y + rect.height / 2) / fixture.browserPageGeometry.viewport.height,
    });
    const inputPoint = sourcePoint(...Object.values(pagePoint(fixture.browserPageGeometry.input)));
    await page.mouse.click(inputPoint.x, inputPoint.y);
    await page.keyboard.type('saved browser value');
    const incrementPoint = sourcePoint(...Object.values(pagePoint(fixture.browserPageGeometry.button)));
    await page.mouse.click(incrementPoint.x, incrementPoint.y);
    const wheelPoint = sourcePoint(0.8, 0.85);
    await page.mouse.move(wheelPoint.x, wheelPoint.y);
    await page.mouse.wheel(0, 650);
    fixture.browserPageStateAfterInteraction = await inspectBrowserFixture(app, browserUrl);
    await expect.poll(() => telemetry.some((event) => event.type === 'input' && event.value === 'saved browser value'), { timeout: 8000 }).toBe(true);
    await expect.poll(() => telemetry.some((event) => event.type === 'click' && event.count === 1), { timeout: 8000 }).toBe(true);
    await expect.poll(() => telemetry.some((event) => event.type === 'scroll' && event.scrollY > 100), { timeout: 8000 }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(interactionRegion).toHaveCount(0);
    const browserLoadsBeforeSceneContinuity = telemetry.filter((event) => event.type === 'load').length;
    const browserRequestsBeforeSceneContinuity = telemetry.filter((event) => event.path === '/fixture').length;
    await selectScene(page, 'Continuity B');
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await selectScene(page, 'Continuity A');
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await expect.poll(() => telemetry.filter((event) => event.path === '/fixture').length, { timeout: 5000 }).toBe(browserRequestsBeforeSceneContinuity);
    assert.equal(telemetry.filter((event) => event.type === 'load').length, browserLoadsBeforeSceneContinuity, `Browser source page reloaded across matching scenes: ${JSON.stringify(telemetry)}`);
    const stateEvents = telemetry.filter((event) => ['input', 'click', 'scroll'].includes(event.type));
    assert.ok(stateEvents.some((event) => event.value === 'saved browser value'), 'Browser form input did not reach the local page.');
    assert.ok(stateEvents.some((event) => event.count === 1), 'Browser button state did not reach the local page.');
    assert.ok(stateEvents.some((event) => event.scrollY > 100), 'Browser scroll state did not reach the local page.');
    await page.screenshot({ path: path.join(runRoot, 'browser-preview-return.png') });
    checks.push('Preview browser interaction forwards input, click, scroll, and Escape; local page state/session survives A→B→A');

    const finalBrowserSessions = await snapshotBrowserSessions(app, browserUrl);
    assert.equal(finalBrowserSessions.length, 2, `Expected a single matching browser session after scene changes: ${JSON.stringify(finalBrowserSessions)}`);
    assert.deepEqual({ video: stageSessionCounts.video, audio: stageSessionCounts.audio }, { video: 1, audio: 1 });
    if (rendererErrors.length > 0) throw new Error(`Unexpected renderer errors: ${JSON.stringify(rendererErrors, null, 2)}`);
    const summary = {
      passed: true,
      runRoot,
      electron: { version: electronPackage.version, packagePath: electronPackagePath, binary: electronBinary },
      ports: { browserFixture: browserPort, remoteDebugging: debugPort },
      fixture,
      checks,
      rendererErrors,
      browserTelemetry: telemetry,
      browserWindows: finalBrowserSessions,
      mediaTimes: await mediaTimes(page),
    };
    await fs.writeFile(path.join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const failure = {
      passed: false,
      runRoot,
      electron: { version: electronPackage.version, packagePath: electronPackagePath, binary: electronBinary },
      ports: { browserFixture: browserPort, remoteDebugging: debugPort },
      fixture,
      checks,
      rendererErrors,
      browserTelemetry: telemetry,
      error: String(error),
    };
    if (page) {
      failure.bodyText = await page.locator('body').innerText().catch(() => '<unavailable>');
      await page.screenshot({ path: path.join(runRoot, 'failure.png') }).catch(() => undefined);
    }
    await fs.writeFile(path.join(runRoot, 'failure.json'), JSON.stringify(failure, null, 2));
    console.error(JSON.stringify(failure, null, 2));
    throw error;
  } finally {
    const child = app.process();
    let timer;
    try {
      await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => { timer = setTimeout(() => { child.kill(); resolve(); }, 5000); })]);
    } finally {
      clearTimeout(timer);
      await fs.rm(path.join(runRoot, 'app-data'), { recursive: true, force: true });
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

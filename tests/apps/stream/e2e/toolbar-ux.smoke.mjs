import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const require = createRequire(path.resolve('package.json'));
const streamRequire = createRequire(path.resolve('apps/stream/package.json'));
const { _electron: electron, expect } = require('@playwright/test');
const sharp = streamRequire('sharp');
const electronBinary = streamRequire('electron');
const electronVersion = streamRequire('electron/package.json').version;
const outputRoot = path.resolve('output/playwright/toolbar-ux-review');
const assetIds = Object.fromEntries(['pptx', 'slideshow', 'pdf'].map((family) => [family, [1, 2, 3].map(() => crypto.randomUUID())]));
const sourceIds = Object.fromEntries(['pptx', 'slideshow', 'pdf', 'video', 'browser', 'group', 'backdrop', 'otherBackdrop'].map((name) => [name, crypto.randomUUID()]));
const sceneIds = { program: crypto.randomUUID(), empty: crypto.randomUUID(), other: crypto.randomUUID() };

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
  await new Promise((resolve) => server.close(resolve));
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

function environment() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  return env;
}

async function makeVideo(runRoot) {
  const bootstrap = path.join(runRoot, 'media-generator.cjs');
  await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron');app.setPath('appData',${JSON.stringify(path.join(runRoot, 'generator-data'))});app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:320,height:180,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});window.loadURL('about:blank');});`);
  const app = await electron.launch({ executablePath: electronBinary, args: [bootstrap], env: environment() });
  try {
    const page = await app.firstWindow();
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d');
      const stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      let frame = 0;
      const draw = setInterval(() => {
        context.fillStyle = frame++ % 2 ? '#4d6eaa' : '#27466a';
        context.fillRect(0, 0, 320, 180);
      }, 80);
      const complete = new Promise((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = reject;
        recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));
      });
      recorder.start(100);
      setTimeout(() => { recorder.stop(); clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); }, 1200);
      return complete;
    });
    return Buffer.from(bytes);
  } finally { await closeApp(app); }
}

function source(id, name, kind, transform, extras = {}) {
  return { id, name, kind, visible: true, muted: true, volume: 1, transform, ...extras };
}

function projectFor(browserUrl, videoId) {
  const images = (family) => assetIds[family].map((assetId, index) => ({ assetId, assetExtension: 'png', name: `Page ${index + 1}` }));
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
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
    studioMode: true, activeSceneId: sceneIds.program, liveSceneId: sceneIds.program,
    hotkeys: { toggleStreaming: 'Control+Alt+F9', toggleRecording: 'Control+Alt+F10', toggleReplayBuffer: 'Control+Alt+F11', saveReplay: 'Control+Alt+F12' },
    sceneSwitchHotkeys: {}, sourceVisibilityHotkeys: {},
    scenes: [
      { id: sceneIds.program, name: 'Program Scene', sources: [
        source(sourceIds.backdrop, 'Program Backdrop', 'color', bounds, { color: '#16191f' }),
        source(sourceIds.pptx, 'Program PPTX', 'presentation', { x: 0, y: 0, width: 960, height: 540 }, { presentationSlides: images('pptx'), slideIndex: 0 }),
        source(sourceIds.slideshow, 'Image Slideshow', 'slideshow', { x: 960, y: 0, width: 960, height: 540 }, { slideshowImages: images('slideshow'), slideIndex: 0, slideshowAutoAdvance: false }),
        source(sourceIds.group, 'Capture group', 'group', bounds, { children: [
          source(sourceIds.pdf, 'Grouped PDF', 'presentation', { x: 0, y: 540, width: 640, height: 360 }, { presentationSlides: images('pdf'), slideIndex: 0 }),
          source(sourceIds.video, 'Grouped Video', 'media', { x: 640, y: 540, width: 640, height: 360 }, { assetId: videoId, assetExtension: 'webm', mediaKind: 'video', loop: true, restartPlaybackWhenActive: false }),
          source(sourceIds.browser, 'Grouped Browser', 'browser', { x: 1280, y: 540, width: 640, height: 360 }, { url: browserUrl, browserAudioEnabled: false }),
        ] }),
      ] },
      { id: sceneIds.empty, name: 'Empty Preview', sources: [] },
      { id: sceneIds.other, name: 'Other Preview', sources: [source(sourceIds.otherBackdrop, 'Other Backdrop', 'color', bounds, { color: '#524468' })] },
    ],
  };
}

async function sampleProgram(page) {
  return page.locator('.program-panel canvas').evaluate((canvas) => [...canvas.getContext('2d').getImageData(Math.round(canvas.width * 800 / 1920), Math.round(canvas.height * 400 / 1080), 1, 1).data].slice(0, 3));
}

async function imageCount(page, family) {
  return page.evaluate((ids) => (window.__toolbarImages ?? []).filter((image) => ids.some((id) => (image.getAttribute('src') ?? '').includes(`${id}.png`))).length, assetIds[family]);
}

async function browserCount(app, browserUrl) {
  return app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed() && window.webContents.getURL().startsWith(url)).length, browserUrl);
}

async function chooseSlides(page, name) {
  await page.getByRole('combobox', { name: 'Slide source', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('group', { name: 'Slides', exact: true })).toHaveAttribute('title', name);
}

async function expectPage(page, number) {
  await expect(page.getByRole('status', { name: `Slide ${number} of 3`, exact: true })).toBeVisible();
}

async function setVisible(page, name, visible) {
  const eye = page.getByRole('button', { name: `Visible ${name}`, exact: true });
  if ((await eye.getAttribute('aria-pressed')) !== String(visible)) await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', String(visible));
}

async function layout(page, width, runRoot) {
  await page.setViewportSize({ width, height: width === 1100 ? 680 : 960 });
  const geometry = await page.evaluate(() => {
    const button = (name) => [...document.querySelectorAll('button')].find((element) => element.getAttribute('aria-label') === name || element.textContent.trim() === name);
    const bounds = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const studio = button('Studio Mode'), projector = button('Open program projector'), settings = button('Open settings');
    const toolbar = document.querySelector('[role=toolbar][aria-label="Program controls"]');
    const counter = toolbar.querySelector('[role=status]');
    return {
      studio: bounds(studio), projector: bounds(projector), settings: bounds(settings),
      inHeader: [studio, projector, settings].every((element) => !!element.closest('header')),
      toolbar: bounds(toolbar), counter: bounds(counter), toolbarText: toolbar.innerText,
      titleBarActions: document.querySelector('header [data-slot=end]')?.innerText ?? '',
    };
  });
  assert.equal(geometry.inHeader, true, 'Studio, projector, and Settings must be in the title bar.');
  assert.ok(geometry.studio.right <= geometry.projector.left && geometry.projector.right <= geometry.settings.left, 'Title-bar actions overlap or have the wrong order.');
  assert.ok(geometry.settings.right <= width && geometry.studio.top >= 0 && geometry.settings.bottom <= 40, 'Title-bar actions exceed their bounds.');
  assert.ok(geometry.counter.right <= geometry.toolbar.right && geometry.counter.right >= geometry.toolbar.right - 20, 'Slide controls are not at the far right of the toolbar.');
  assert.ok(!/\d+\s*%/.test(geometry.toolbarText), 'The percentage indicator remains in the toolbar.');
  await page.screenshot({ path: path.join(runRoot, `toolbar-${width}.png`) });
  return geometry;
}

async function main() {
  assert.equal(electronVersion, '44.3.0', 'Use the Stream workspace Electron.');
  const runRoot = path.join(outputRoot, `run-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  await fs.mkdir(runRoot, { recursive: true });
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><body style="background:#273e6b;color:white;font:32px sans-serif">Grouped browser fixture</body>');
  });
  const browserUrl = `http://127.0.0.1:${await listen(server)}/fixture`;
  server.unref();
  const media = path.join(runRoot, 'app-data/LumaStream/media');
  await fs.mkdir(media, { recursive: true });
  const colors = ['#d73030', '#2eb457', '#3160d6'];
  for (const ids of Object.values(assetIds)) for (let index = 0; index < ids.length; index += 1) {
    await sharp({ create: { width: 960, height: 540, channels: 4, background: colors[index] } }).png().toFile(path.join(media, `${ids[index]}.png`));
  }
  const videoId = crypto.randomUUID();
  const videoBytes = process.env.LUMASTREAM_TOOLBAR_VIDEO_FIXTURE
    ? await fs.readFile(process.env.LUMASTREAM_TOOLBAR_VIDEO_FIXTURE)
    : await makeVideo(runRoot);
  await fs.writeFile(path.join(media, `${videoId}.webm`), videoBytes);
  await fs.writeFile(path.join(runRoot, 'app-data/LumaStream/scene-collection.json'), JSON.stringify(projectFor(browserUrl, videoId)));
  const bootstrap = path.join(runRoot, 'bootstrap.cjs');
  await fs.writeFile(bootstrap, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(path.join(runRoot, 'app-data'))});require(${JSON.stringify(path.resolve('apps/stream/out/main/index.js'))});`);
  const app = await electron.launch({ executablePath: electronBinary, args: [`--remote-debugging-port=${await freePort()}`, '--autoplay-policy=no-user-gesture-required', bootstrap], env: environment(), timeout: 30000 });
  const rendererErrors = [], checks = [], measurements = {};
  let page;
  try {
    page = await app.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push(error.message));
    page.on('console', (entry) => { if (entry.type() === 'error') rendererErrors.push(entry.text()); });
    await page.addInitScript(() => {
      window.__toolbarImages = [];
      window.Image = new Proxy(window.Image, { construct(target, args) { const image = Reflect.construct(target, args); window.__toolbarImages.push(image); return image; } });
      window.__toolbarMediaTrace = [];
      const ids = new WeakMap();
      let sequence = 0;
      const record = (kind, element, extra = {}) => {
        if (!(element instanceof HTMLVideoElement)) return;
        if (!ids.has(element)) {
          ids.set(element, ++sequence);
          for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'seeking', 'seeked', 'emptied', 'error', 'play', 'pause']) element.addEventListener(event, () => record(event, element));
        }
        if (window.__toolbarMediaTrace.length >= 400) return;
        window.__toolbarMediaTrace.push({ kind, node: ids.get(element), at: performance.now(), time: element.currentTime,
          paused: element.paused, readyState: element.readyState, duration: String(element.duration), isConnected: element.isConnected,
          dataset: { ...element.dataset }, src: element.getAttribute('src'), currentSrc: element.currentSrc,
          seekable: Array.from({ length: element.seekable.length }, (_, index) => [element.seekable.start(index), element.seekable.end(index)]),
          ...extra });
      };
      const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...time, set(value) { record('seek-request', this, { value }); time.set.call(this, value); record('seek-applied', this, { value }); } });
      for (const property of ['src', 'srcObject']) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, property);
        Object.defineProperty(HTMLMediaElement.prototype, property, { ...descriptor, set(value) {
          record(`${property}-before`, this, { value: value === null ? null : String(value) });
          descriptor.set.call(this, value);
          record(`${property}-after`, this, { value: value === null ? null : String(value) });
        } });
      }
      for (const method of ['pause', 'load']) {
        const original = HTMLMediaElement.prototype[method];
        HTMLMediaElement.prototype[method] = function (...args) { record(`${method}-before`, this); const result = original.apply(this, args); record(`${method}-after`, this); return result; };
      }
    });
    await page.reload();
    await page.getByRole('button', { name: 'Program Scene', exact: true }).waitFor();
    await expect.poll(() => imageCount(page, 'pptx')).toBe(3);
    await expect.poll(() => browserCount(app, browserUrl)).toBe(1);
    await chooseSlides(page, 'Program PPTX');
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expectPage(page, 2);
    measurements.wide = await layout(page, 1560, runRoot);
    measurements.narrow = await layout(page, 1100, runRoot);
    checks.push('Studio Mode/projector sit beside Settings; slide controls align at the far right at 1560px and 1100px without overlap or percentage indicator');

    await page.getByRole('button', { name: 'Empty Preview', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Slides', exact: true })).toHaveAttribute('title', 'Program PPTX');
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expectPage(page, 3);
    await expect.poll(() => sampleProgram(page)).toEqual([49, 96, 214]);
    await page.screenshot({ path: path.join(runRoot, 'empty-preview-live-target.png') });
    await page.getByRole('button', { name: 'Other Preview', exact: true }).click();
    await page.getByRole('treeitem').filter({ hasText: 'Other Backdrop' }).click();
    await expect(page.getByRole('group', { name: 'Slides', exact: true })).toHaveAttribute('title', 'Program PPTX');
    await page.getByRole('button', { name: 'Previous slide', exact: true }).click();
    await expectPage(page, 2);
    await page.getByRole('button', { name: 'Program Scene', exact: true }).click();
    await page.getByRole('treeitem').filter({ hasText: 'Image Slideshow' }).click();
    await expect(page.getByRole('group', { name: 'Slides', exact: true })).toHaveAttribute('title', 'Program PPTX');
    checks.push('Explicit Program PPTX target persists through Empty Preview, another Preview scene, and unrelated source-row selection; arrows still change Program pixels');

    await setVisible(page, 'Program PPTX', false);
    await expectPage(page, 2);
    await expect.poll(() => imageCount(page, 'pptx')).toBe(3);
    await expect.poll(() => sampleProgram(page)).toEqual([46, 180, 87]);
    await page.screenshot({ path: path.join(runRoot, 'studio-hide-staged.png') });
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await expect.poll(() => imageCount(page, 'pptx')).toBe(0);
    await expect.poll(() => page.evaluate(() => document.querySelector('[role=group][aria-label="Slides"]')?.getAttribute('title') ?? null)).not.toBe('Program PPTX');
    checks.push('Studio visibility edits retain Program/resources until Transition, then release a fully hidden deck');
    await setVisible(page, 'Program PPTX', true);
    await chooseSlides(page, 'Program PPTX');
    await expectPage(page, 2);
    await page.getByRole('button', { name: 'Transition scene', exact: true }).click();
    await expect.poll(() => sampleProgram(page)).toEqual([46, 180, 87]);
    await expect(page.getByRole('button', { name: 'Studio Mode', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Studio Mode', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Studio Mode', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await setVisible(page, 'Program PPTX', false);
    await expect.poll(() => imageCount(page, 'pptx')).toBe(0);
    await page.getByRole('combobox', { name: 'Slide source', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Program PPTX', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await setVisible(page, 'Program PPTX', true);
    await chooseSlides(page, 'Program PPTX');
    await expectPage(page, 2);
    checks.push('Direct-mode hide excludes the deck from toolbar choices and releases image resources; unhide preserves its current page');

    await chooseSlides(page, 'Grouped PDF');
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expectPage(page, 2);
    const video = page.locator(`video[data-stage-source="${sourceIds.video}"]`);
    await page.getByRole('treeitem').filter({ hasText: 'Grouped Video' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Properties', exact: true }).click();
    const videoProperties = page.getByRole('dialog', { name: 'Source Properties', exact: true });
    await videoProperties.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
    await video.evaluate((element) => { element.currentTime = 0.65; });
    await expect.poll(() => video.evaluate((element) => element.readyState >= 2 && !element.seeking && element.currentTime >= 0.4)).toBe(true);
    measurements.pausedVideo = await video.evaluate((element) => ({ currentTime: element.currentTime, paused: element.paused, ended: element.ended }));
    assert.ok(measurements.pausedVideo.currentTime >= 0.4, 'Pause far enough from zero to distinguish a restored playhead from a fresh player.');
    await page.screenshot({ path: path.join(runRoot, 'paused-video-properties.png') });
    await videoProperties.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await setVisible(page, 'Capture group', false);
    await expect.poll(() => imageCount(page, 'pdf')).toBe(0);
    await expect(page.locator('video[data-stage-runtime-source]')).toHaveCount(0);
    await expect.poll(() => browserCount(app, browserUrl)).toBe(0);
    await page.screenshot({ path: path.join(runRoot, 'direct-group-hidden.png') });
    await setVisible(page, 'Capture group', true);
    await expect.poll(() => imageCount(page, 'pdf')).toBe(3);
    await expect(page.locator('video[data-stage-runtime-source]')).toHaveCount(1);
    await expect.poll(() => browserCount(app, browserUrl)).toBe(1);
    await expect.poll(() => video.evaluate((element, position) => element.readyState >= 2 && element.paused && !element.seeking && Math.abs(element.currentTime - position) <= 0.25, measurements.pausedVideo.currentTime)).toBe(true);
    measurements.restoredPausedVideo = await video.evaluate((element) => ({ currentTime: element.currentTime, paused: element.paused, ended: element.ended }));
    await chooseSlides(page, 'Grouped PDF');
    await expectPage(page, 2);
    await page.screenshot({ path: path.join(runRoot, 'group-restored-cursor.png') });
    checks.push('Hidden group ancestors release child slide images, DOM video, and native browser session; unhide restores resources and preserves the slide cursor');
    await setVisible(page, 'Capture group', false);
    await expect(video).toHaveCount(0);
    await expect.poll(() => browserCount(app, browserUrl)).toBe(0);
    await setVisible(page, 'Capture group', true);
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate((element, position) => element.readyState >= 2 && element.paused && !element.seeking && Math.abs(element.currentTime - position) <= 0.25, measurements.pausedVideo.currentTime)).toBe(true);
    measurements.restoredAgainPausedVideo = await video.evaluate((element) => ({ currentTime: element.currentTime, paused: element.paused, ended: element.ended }));
    checks.push('Properties Pause survives two group hide/unhide DOM-player evictions at the same position within 0.25 seconds');
    assert.deepEqual(rendererErrors, []);
    const summary = { passed: true, electronVersion, runRoot, renderer: await page.locator('script[type=module]').getAttribute('src'), checks, measurements, rendererErrors };
    await fs.writeFile(path.join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const failure = { passed: false, runRoot, error: String(error), checks, measurements, rendererErrors };
    if (page) {
      await page.screenshot({ path: path.join(runRoot, 'failure.png') }).catch(() => undefined);
      failure.body = await page.locator('body').innerText().catch(() => '');
      failure.media = await page.locator('video[data-stage-runtime-source]').evaluateAll((elements) => elements.map((element) => ({
        currentTime: element.currentTime, paused: element.paused, ended: element.ended, seeking: element.seeking,
        readyState: element.readyState, duration: String(element.duration), src: element.getAttribute('src'),
        seekable: Array.from({ length: element.seekable.length }, (_, index) => [element.seekable.start(index), element.seekable.end(index)]),
        buffered: Array.from({ length: element.buffered.length }, (_, index) => [element.buffered.start(index), element.buffered.end(index)]),
      }))).catch(() => []);
      failure.mediaTrace = await page.evaluate(() => window.__toolbarMediaTrace ?? []).catch(() => []);
    }
    await fs.writeFile(path.join(runRoot, 'failure.json'), JSON.stringify(failure, null, 2));
    console.error(JSON.stringify(failure, null, 2));
    throw error;
  } finally { await closeApp(app); await new Promise((resolve) => server.close(resolve)); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

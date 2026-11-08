import { resolveAppElectron } from '../../../../tool/app-electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const appRequire = createRequire(path.resolve('apps/stream/package.json'));
const playwrightRequire = createRequire(path.resolve('package.json'));
const { _electron: electron, expect } = playwrightRequire('@playwright/test');
const sharp = appRequire('sharp');
const { binaryPath: electronBinary, version: electronVersion } = resolveAppElectron('stream');

const outputRoot = path.resolve('output/playwright/canvas-interaction-e2e');
const canvas = { width: 1920, height: 1080 };
const output = { width: 1280, height: 1024 };
const sourceId = crypto.randomUUID();
const targetId = crypto.randomUUID();
const assetId = crypto.randomUUID();
const sceneId = crypto.randomUUID();

function uuid() { return crypto.randomUUID(); }

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

function stripeImage(width = 800, height = 400) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bright = Math.floor(x / 16) % 2 === 0;
      const offset = (y * width + x) * 3;
      pixels[offset] = bright ? 240 : 24;
      pixels[offset + 1] = bright ? 230 : 42;
      pixels[offset + 2] = bright ? 210 : 58;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function makeProject() {
  return {
    version: 1,
    output: {
      baseWidth: canvas.width, baseHeight: canvas.height,
      width: output.width, height: output.height, frameRate: 30,
      streamVideoBitrateKbps: 6000, streamAudioBitrateKbps: 160, streamAudioTrack: 1,
      streamRateControl: 'cbr', streamVideoEncoder: 'libopenh264', streamEncoderQuality: 60,
      streamHardwareEncoding: false, streamKeyframeIntervalSeconds: 2,
      recordingVideoBitrateKbps: 8000, recordingAudioBitrateKbps: 160, recordingAudioTracks: [1],
      recordingContainer: 'webm', recordingRateControl: 'cbr', recordingVideoEncoder: 'libopenh264',
      recordingEncoderQuality: 60, recordingHardwareEncoding: false, recordingKeyframeIntervalSeconds: 2,
    },
    studioMode: false,
    activeSceneId: sceneId,
    liveSceneId: sceneId,
    hotkeys: {
      toggleStreaming: 'Control+Alt+F9', toggleRecording: 'Control+Alt+F10',
      toggleReplayBuffer: 'Control+Alt+F11', saveReplay: 'Control+Alt+F12',
    },
    sceneSwitchHotkeys: {},
    sourceVisibilityHotkeys: {},
    scenes: [{
      id: sceneId,
      name: 'Canvas Interaction Fixture',
      sources: [
        {
          id: sourceId, name: 'Transform Pattern Image', kind: 'image', visible: true, muted: false, volume: 1,
          transform: { x: 200, y: 180, width: 400, height: 200, rotation: 0 },
          assetId, assetExtension: 'png', mediaKind: 'image',
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        {
          id: targetId, name: 'Snap Target', kind: 'color', visible: true, muted: false, volume: 1,
          transform: { x: 1000, y: 180, width: 320, height: 200, rotation: 0 }, color: '#287b61',
        },
      ],
    }],
  };
}

async function seedFixture(runRoot) {
  const appDataPath = path.join(runRoot, 'app-data');
  const mediaDirectory = path.join(appDataPath, 'LumaStream', 'media');
  const collectionDirectory = path.join(appDataPath, 'LumaStream', 'scene-collections');
  await fs.mkdir(mediaDirectory, { recursive: true });
  await fs.mkdir(collectionDirectory, { recursive: true });
  await fs.writeFile(path.join(mediaDirectory, `${assetId}.png`), await stripeImage());
  const collectionId = uuid();
  const projectPath = path.join(collectionDirectory, `${collectionId}.json`);
  await fs.writeFile(path.join(collectionDirectory, 'index.json'), JSON.stringify({
    version: 1, activeCollectionId: collectionId, collections: [{ id: collectionId, name: 'Canvas Interaction E2E' }],
  }, null, 2));
  await fs.writeFile(projectPath, JSON.stringify(makeProject(), null, 2));
  return { appDataPath, projectPath, collectionId };
}

function readProject(projectPath) {
  return fs.readFile(projectPath, 'utf8').then((contents) => JSON.parse(contents));
}

async function savedSource(projectPath) {
  const project = await readProject(projectPath);
  return project.scenes.find((scene) => scene.id === sceneId)?.sources.find((source) => source.id === sourceId);
}

async function waitForSource(projectPath, predicate, message) {
  await expect.poll(async () => {
    try { return predicate(await savedSource(projectPath)); }
    catch { return false; }
  }, { timeout: 8000, message }).toBe(true);
  return savedSource(projectPath);
}

function viewport() {
  const scale = Math.min(output.width / canvas.width, output.height / canvas.height);
  return {
    x: (output.width - canvas.width * scale) / 2,
    y: (output.height - canvas.height * scale) / 2,
    scale,
  };
}

async function stageBounds(page) {
  const bounds = await page.locator('.program-panel .stage-surface').boundingBox();
  assert.ok(bounds, 'Program stage surface is visible');
  return bounds;
}

async function settleRenderer(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function canvasToClient(page, x, y) {
  const bounds = await stageBounds(page);
  const fitted = viewport();
  const outputX = fitted.x + x * fitted.scale;
  const outputY = fitted.y + y * fitted.scale;
  return {
    x: bounds.x + outputX / output.width * bounds.width,
    y: bounds.y + outputY / output.height * bounds.height,
  };
}

async function clientToCanvas(page, x, y) {
  const bounds = await stageBounds(page);
  const outputX = (x - bounds.x) / bounds.width * output.width;
  const outputY = (y - bounds.y) / bounds.height * output.height;
  const fitted = viewport();
  return { x: (outputX - fitted.x) / fitted.scale, y: (outputY - fitted.y) / fitted.scale };
}

async function readStripeRuns(page, transform) {
  const y = transform.y + transform.height / 2;
  const start = await canvasToClient(page, transform.x + 24, y);
  const end = await canvasToClient(page, transform.x + Math.min(transform.width - 24, 224), y);
  const clip = { x: start.x, y: start.y, width: Math.max(32, end.x - start.x), height: 2 };
  const screenshot = await page.screenshot({ clip });
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rowOffset = Math.floor(info.height / 2) * info.width * info.channels;
  const brightness = [];
  for (let x = 0; x < info.width; x += 1) {
    const offset = rowOffset + x * info.channels;
    brightness.push(data[offset] + data[offset + 1] + data[offset + 2]);
  }
  const transitions = [];
  for (let x = 1; x < brightness.length; x += 1) {
    if (Math.abs(brightness[x] - brightness[x - 1]) > 80) transitions.push(x);
  }
  const runs = transitions.slice(1).map((transition, index) => transition - transitions[index]);
  assert.ok(runs.length >= 8, `Expected a visible striped image in the sample; found ${runs.length} pixel transitions`);
  const sorted = [...runs].sort((left, right) => left - right);
  return { medianRunPx: sorted[Math.floor(sorted.length / 2)], transitionCount: transitions.length, sampleWidthPx: info.width };
}

async function startHandleDrag(page, handle, dx, dy, modifier, holdAlt = false) {
  const node = page.locator(`.program-panel [data-resize-handle="${handle}"]`);
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  assert.ok(box, `Resize handle ${handle} has visible bounds`);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const sceneStart = await clientToCanvas(page, start.x, start.y);
  const finish = await canvasToClient(page, sceneStart.x + dx, sceneStart.y + dy);
  if (modifier) await page.keyboard.down(modifier);
  if (holdAlt) await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(finish.x, finish.y, { steps: 8 });
  return async () => {
    await page.mouse.up();
    if (holdAlt) await page.keyboard.up('Alt');
    if (modifier) await page.keyboard.up(modifier);
  };
}

async function dragSource(page, startCanvas, deltaX, deltaY, holdAlt = false) {
  const start = await canvasToClient(page, startCanvas.x, startCanvas.y);
  const finish = await canvasToClient(page, startCanvas.x + deltaX, startCanvas.y + deltaY);
  if (holdAlt) await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(finish.x, finish.y, { steps: 8 });
  return async () => {
    await page.mouse.up();
    if (holdAlt) await page.keyboard.up('Alt');
  };
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
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function main() {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const runRoot = path.join(outputRoot, `run-${stamp}-${process.pid}`);
  await fs.mkdir(runRoot, { recursive: true });

  const fixture = await seedFixture(runRoot);
  const debugPort = await freePort();
  const bootstrap = path.join(runRoot, 'bootstrap.cjs');
  await fs.writeFile(bootstrap, `
    const { app } = require('electron');
    app.setPath('appData', ${JSON.stringify(fixture.appDataPath)});
    app.setPath('userData', ${JSON.stringify(path.join(runRoot, 'user-data'))});
    require(${JSON.stringify(path.resolve('apps/stream/out/main/index.js'))});
  `);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [`--remote-debugging-port=${debugPort}`, '--autoplay-policy=no-user-gesture-required', bootstrap],
    env,
    timeout: 30000,
  });
  const checks = [];
  const rendererErrors = [];
  let page;
  let failure = null;
  let screenshotPaths = [];
  let captured = {};

  try {
    page = await app.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push({ kind: 'pageerror', message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push({ kind: 'console', message: message.text() });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.program-panel .stage-surface').waitFor({ timeout: 30000 });
    await page.evaluate(() => {
      const stage = document.querySelector('.program-panel .stage-surface');
      window.__canvasInteractionPointerLog = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) stage?.addEventListener(type, (event) => {
        const bounds = stage.getBoundingClientRect();
        window.__canvasInteractionPointerLog.push({ type, x: event.clientX, y: event.clientY, buttons: event.buttons,
          target: event.target instanceof HTMLElement ? event.target.getAttribute('data-resize-handle') : null,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } });
      }, true);
    });
    await expect(page.locator('[role="treeitem"]').filter({ hasText: 'Transform Pattern Image' })).toBeVisible();
    const stage = await stageBounds(page);
    assert.ok(Math.abs(stage.width / stage.height - output.width / output.height) < 0.03,
      `Output stage should match its seeded 5:4 output size, saw ${stage.width}x${stage.height}`);
    const fitted = viewport();
    assert.ok(fitted.y > 0, 'The 16:9 source canvas is letterboxed vertically inside the 5:4 output');
    await page.screenshot({ path: path.join(runRoot, 'startup.png') });
    screenshotPaths.push(path.join(runRoot, 'startup.png'));

    await page.locator('[role="treeitem"]').filter({ hasText: 'Transform Pattern Image' }).click();
    await expect(page.locator('.program-panel [data-resize-handle="se"]')).toBeVisible();
    await expect.poll(async () => readStripeRuns(page, { x: 200, y: 180, width: 400, height: 200 })).toBeTruthy();
    const shiftFinish = await startHandleDrag(page, 'se', 80, 20, 'Shift');
    const shiftSource = await waitForSource(fixture.projectPath,
      (source) => source?.transform.width === 480 && source?.transform.height === 240,
      'Shift-dragged resize should preserve the image aspect ratio');
    await shiftFinish();
    await settleRenderer(page);
    assert.equal(shiftSource.transform.x, 200, 'Shift resize keeps the opposite northwest anchor fixed');
    assert.equal(shiftSource.transform.y, 180, 'Shift resize keeps the opposite northwest anchor fixed');
    assert.equal(shiftSource.transform.width / shiftSource.transform.height, 2, 'Shift resize preserves the original 2:1 aspect ratio');
    checks.push('Shift-drag on a resize handle preserves aspect ratio and the opposite anchor');
    const afterShiftRuns = await readStripeRuns(page, shiftSource.transform);
    captured.shiftResize = { transform: shiftSource.transform, stripeRuns: afterShiftRuns };
    const shiftShot = path.join(runRoot, 'shift-resize.png');
    await page.screenshot({ path: shiftShot });
    screenshotPaths.push(shiftShot);

    const cropModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const cropFinish = await startHandleDrag(page, 'e', -40, 0, cropModifier);
    const croppedSource = await waitForSource(fixture.projectPath,
      (source) => (source?.crop?.right ?? 0) > 0 && source?.transform.width < 480,
      `${cropModifier} resize-handle drag should crop image content`);
    await cropFinish();
    await settleRenderer(page);
    assert.ok(croppedSource.crop.right >= 60 && croppedSource.crop.right <= 75,
      `Expected right crop near 40 canvas units at the current pixel scale; saw ${croppedSource.crop.right}`);
    const afterCropRuns = await readStripeRuns(page, croppedSource.transform);
    const stripeScaleDelta = Math.abs(afterCropRuns.medianRunPx - afterShiftRuns.medianRunPx);
    assert.ok(stripeScaleDelta <= 1,
      `Crop should preserve displayed pixel scale; stripe run changed by ${stripeScaleDelta}px (${JSON.stringify(afterShiftRuns)} -> ${JSON.stringify(afterCropRuns)})`);
    captured.crop = {
      crop: croppedSource.crop, transform: croppedSource.transform, cropModifier,
      before: afterShiftRuns, after: afterCropRuns, stripeScaleDelta,
    };
    checks.push(`${cropModifier} resize-handle drag crops source pixels while preserving their displayed scale`);
    const cropShot = path.join(runRoot, 'crop.png');
    await page.screenshot({ path: cropShot });
    screenshotPaths.push(cropShot);

    const sourceRightBeforeSnap = croppedSource.transform.x + croppedSource.transform.width;
    assert.ok(Math.abs(sourceRightBeforeSnap - 640) <= 1, `Crop should preserve the handle's fixed left edge and pixel scale; right edge is ${sourceRightBeforeSnap}`);
    const snapFinish = await dragSource(page, { x: croppedSource.transform.x + 180, y: croppedSource.transform.y + 100 }, 355, 0);
    await expect(page.locator('.program-panel .source-snap-guide--x')).toBeVisible({ timeout: 3000 });
    const snapSource = await waitForSource(fixture.projectPath,
      (source) => Math.abs(source?.transform.x + source?.transform.width - 1000) <= 1,
      'Moved image should snap its right edge to the stationary target left edge');
    const guide = page.locator('.program-panel .source-snap-guide--x');
    const guideBox = await guide.boundingBox();
    assert.ok(guideBox, 'Visible x snap guide has bounds');
    const expectedGuide = await canvasToClient(page, 1000, 0);
    assert.ok(Math.abs((guideBox.x + guideBox.width / 2) - expectedGuide.x) <= 1.5,
      `Snap guide should use output scaling through letterboxing; guide x=${guideBox.x}, expected=${expectedGuide.x}`);
    const snapShot = path.join(runRoot, 'snap-guide-letterboxed.png');
    await page.screenshot({ path: snapShot });
    screenshotPaths.push(snapShot);
    captured.snap = {
      transform: snapSource.transform, guide: { x: guideBox.x, y: guideBox.y, width: guideBox.width, height: guideBox.height },
      expectedGuideX: expectedGuide.x, outputLetterboxY: fitted.y,
    };
    await snapFinish();
    await settleRenderer(page);
    await expect(guide).toHaveCount(0);
    checks.push('moving source snaps its edge to a stationary source edge and the visible guide aligns through output letterboxing');

    const altStart = { x: snapSource.transform.x + 180, y: snapSource.transform.y + 100 };
    const altFinish = await dragSource(page, altStart, -5, 0, true);
    const altSource = await waitForSource(fixture.projectPath,
      (source) => Math.abs(source?.transform.x - (snapSource.transform.x - 5)) <= 1,
      'Alt-drag near a snap target should preserve the pointer movement instead of snapping');
    await altFinish();
    await settleRenderer(page);
    assert.ok(Math.abs(altSource.transform.x - (snapSource.transform.x - 5)) <= 1,
      `Alt should bypass snapping; expected x=${snapSource.transform.x - 5}, saw ${altSource.transform.x}`);
    await expect(page.locator('.program-panel .source-snap-guide')).toHaveCount(0);
    captured.altBypass = { beforeX: snapSource.transform.x, afterX: altSource.transform.x };
    checks.push('Alt-drag bypasses snapping and does not show snap guides');

    const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('[role="treeitem"]').filter({ hasText: 'Transform Pattern Image' }).click();
    await page.keyboard.press(`${primary}+d`);
    const centeredSource = await waitForSource(fixture.projectPath,
      (source) => Math.abs(source?.transform.x - (canvas.width - altSource.transform.width) / 2) <= 1
        && Math.abs(source?.transform.y - (canvas.height - altSource.transform.height) / 2) <= 1,
      'Center shortcut should place the selected image at canvas center');
    const centerShot = path.join(runRoot, 'shortcut-center.png');
    await page.screenshot({ path: centerShot });
    screenshotPaths.push(centerShot);
    await page.keyboard.press(`${primary}+f`);
    const fitSource = await waitForSource(fixture.projectPath,
      (source) => source?.transform.x === 0 && source?.transform.y === 60
        && source?.transform.width === 1920 && source?.transform.height === 960,
      'Fit shortcut should preserve image aspect ratio and fit the source inside the canvas');
    const fitShot = path.join(runRoot, 'shortcut-fit.png');
    await page.screenshot({ path: fitShot });
    screenshotPaths.push(fitShot);
    await page.keyboard.press(`${primary}+r`);
    const resetSource = await waitForSource(fixture.projectPath,
      (source) => source?.transform.x === 0 && source?.transform.y === 0
        && source?.transform.width === canvas.width && source?.transform.height === canvas.height,
      'Reset shortcut should restore the default source transform');
    const resetShot = path.join(runRoot, 'shortcut-reset.png');
    await page.screenshot({ path: resetShot });
    screenshotPaths.push(resetShot);
    captured.shortcuts = {
      primary, center: centeredSource.transform, fit: fitSource.transform, reset: resetSource.transform,
    };
    checks.push(`${primary} + D, F, and R center, fit, and reset the selected source`);

    assert.deepEqual(rendererErrors, [], `Renderer errors were recorded: ${JSON.stringify(rendererErrors)}`);
  } catch (error) {
    failure = { message: error?.message ?? String(error), stack: error?.stack };
    if (page) {
      try { captured.pointerLog = await page.evaluate(() => window.__canvasInteractionPointerLog ?? []); }
      catch { /* Keep the first failure if the renderer exited. */ }
      const failureShot = path.join(runRoot, 'failure.png');
      try { await page.screenshot({ path: failureShot, fullPage: true, timeout: 5000 }); screenshotPaths.push(failureShot); }
      catch { /* Keep the first failure even if the renderer exited. */ }
    }
  } finally {
    await closeElectron(app);
    const report = {
      status: failure ? 'failed' : 'passed',
      failure,
      checks,
      rendererErrors,
      electronVersion,
      platform: process.platform,
      debugPort,
      canvas, output, outputLetterbox: viewport(),
      fixture: { sceneId, sourceId, targetId, assetId, collectionId: fixture.collectionId },
      appDataPath: fixture.appDataPath,
      userDataPath: path.join(runRoot, 'user-data'),
      projectPath: fixture.projectPath,
      screenshots: screenshotPaths,
      evidence: captured,
    };
    await fs.writeFile(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
  if (failure) process.exitCode = 1;
}

await main();

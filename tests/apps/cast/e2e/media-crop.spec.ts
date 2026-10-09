import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect, test, type Page } from '@playwright/test';
import type { ImageElementPayload, VideoElementPayload } from '@lumacast/composition';

const requireFromCast = createRequire(path.resolve('apps/cast/package.json'));
const imageSrc = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><path fill="red" d="M0 0h200v200H0z"/><path fill="blue" d="M200 0h200v200H200z"/></svg>')}`;

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function dragHandle(page: Page, frame: { x: number; y: number; width: number; height: number },
  anchor: 'left' | 'right' | 'bottom-right' | 'top', dx: number, dy: number, crop = true) {
  const canvas = page.locator('[data-ui-region="stage-panel"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / 1920, box.height / 1080);
  const offsetX = box.x + (box.width - 1920 * scale) / 2;
  const offsetY = box.y + (box.height - 1080 * scale) / 2;
  const x = frame.x + (anchor === 'left' ? 0 : anchor === 'top' ? frame.width / 2 : frame.width);
  const y = frame.y + (anchor === 'bottom-right' ? frame.height : anchor === 'top' ? 0 : frame.height / 2);
  await page.mouse.move(offsetX + x * scale, offsetY + y * scale);
  if (crop) await page.keyboard.down(modifier);
  await page.mouse.down();
  await page.mouse.move(offsetX + (x + dx) * scale, offsetY + (y + dy) * scale, { steps: 12 });
  await page.mouse.up();
  if (crop) await page.keyboard.up(modifier);
}

async function paintedColors(page: Page) {
  return page.locator('[data-ui-region="stage-panel"] canvas').first().evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let blue = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 240 && pixels[index + 1] < 15 && pixels[index + 2] < 15) red++;
      if (pixels[index] < 15 && pixels[index + 1] < 15 && pixels[index + 2] > 240) blue++;
    }
    return { red, blue };
  });
}

for (const videoFit of ['cover', 'contain'] as const) {
test(`modifier handles crop images and ${videoFit} videos without scaling, preserve resize and history, and survive relaunch`, async () => {
  test.setTimeout(120_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-media-crop-'));
  const launch = () => _electron.launch({
    executablePath: process.env.ELECTRON_BINARY ?? requireFromCast('electron') as string,
    args: [path.resolve('apps/cast'), `--user-data-dir=${userDataDir}`],
  });
  let app = await launch();
  let imageId = '';
  let videoId = '';
  try {
    const page = await app.firstWindow();
    await page.locator('[data-ui-region="app-toolbar"]').waitFor();
    const created = await page.evaluate(async ({ src, videoFit }) => {
      const { itemId } = await window.castApi.createItem({ type: 'presentation', title: 'Crop E2E', themeId: null });
      const snapshot = await window.castApi.getSnapshot();
      const slide = snapshot.slides.find((entry) => entry.presentationId === itemId)!;
      await window.castApi.createElement({
        slideId: slide.id, type: 'image', x: 200, y: 100, width: 400, height: 400,
        payload: { src, name: 'Crop image fixture', fit: 'fill' },
      });
      // A self-contained video fixture: no ffmpeg dependency or external media.
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 200;
      const context = canvas.getContext('2d')!;
      const paintColorBars = () => {
        context.fillStyle = 'red'; context.fillRect(0, 0, 200, 200);
        context.fillStyle = 'blue'; context.fillRect(200, 0, 200, 200);
      };
      paintColorBars();
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start();
      for (let index = 0; index < 4; index++) {
        paintColorBars();
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const videoSrc = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
      });
      await window.castApi.createElement({
        slideId: slide.id, type: 'video', x: 900, y: 100, width: 400, height: 400,
        payload: { src: videoSrc, fit: videoFit, name: 'Crop video fixture', autoplay: false, loop: true, muted: false, playbackRate: 1.25 },
      });
      const after = await window.castApi.getSnapshot();
      const media = after.slideElements.filter((entry) => entry.slideId === slide.id);
      return { imageId: media.find((entry) => entry.type === 'image')!.id, videoId: media.find((entry) => entry.type === 'video')!.id };
    }, { src: imageSrc, videoFit });
    ({ imageId, videoId } = created);
    await page.reload();
    await page.getByRole('group', { name: 'Application views' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Select item' }).click();
    await page.getByRole('option', { name: 'Crop E2E', exact: true }).click();
    await page.getByRole('grid', { name: 'Current slides' }).getByText('1', { exact: true }).click();
    const saveChanges = async () => {
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pushing…', exact: true })).toBeHidden();
    };
    const read = (id: string) => page.evaluate(async (elementId) => (await window.castApi.getSnapshot()).slideElements.find((entry) => entry.id === elementId)!, id);
    const selectImage = () => page.locator('[data-ui-region="object-list-panel"]').getByText('Crop image fixture', { exact: true }).click();
    await selectImage();
    await expect.poll(async () => (await paintedColors(page)).blue).toBeGreaterThan(100);
    expect(await page.getByRole('button', { name: 'Crop', exact: true }).count()).toBe(0);
    // Ordinary side resizing keeps its existing behavior and authors no crop.
    await dragHandle(page, { x: 200, y: 100, width: 400, height: 400 }, 'right', 100, 0, false);
    await saveChanges();
    const resized = await read(imageId);
    expect(resized.width).toBeCloseTo(500, 0);
    expect(resized.height).toBeCloseTo(400, 0);
    expect(resized.payload).not.toHaveProperty('crop');

    // Crop away the red half. The blue half retains its painted size.
    const videoRow = page.locator('[data-ui-region="object-list-panel"]').getByRole('button').filter({ hasText: 'Crop video fixture' });
    await videoRow.getByRole('button', { name: 'Hide layer' }).click();
    await selectImage();
    await expect.poll(async () => (await paintedColors(page)).red).toBeGreaterThan(100);
    const beforeCrop = await paintedColors(page);
    await dragHandle(page, resized, 'left', resized.width / 2, 0);
    await saveChanges();
    const imageAfter = await read(imageId);
    const crop = (imageAfter.payload as ImageElementPayload).crop!;
    expect(crop.x).toBeCloseTo(0.5, 2);
    expect(crop.width).toBeCloseTo(0.5, 2);
    expect(crop.height).toBeCloseTo(1, 2);
    expect(imageAfter.x).toBeCloseTo(resized.x + resized.width / 2, 0);
    expect(imageAfter.width).toBeCloseTo(resized.width / 2, 0);
    expect(imageAfter.height).toBeCloseTo(resized.height, 0);
    await expect.poll(async () => (await paintedColors(page)).red).toBe(0);
    const afterCrop = await paintedColors(page);
    expect(Math.abs(afterCrop.blue - beforeCrop.blue) / beforeCrop.blue).toBeLessThan(0.04);
    await page.screenshot({ path: 'test-results/media-crop-handles.png' });

    await page.keyboard.press(`${modifier}+z`);
    await saveChanges();
    const undone = await read(imageId);
    expect(undone.width).toBeCloseTo(resized.width, 0);
    expect(undone.payload).not.toHaveProperty('crop');
    await page.keyboard.press(`${modifier}+Shift+z`);
    await saveChanges();
    expect((await read(imageId)).payload).toMatchObject({ crop });

    // Dragging outwards restores hidden source pixels at the same scale.
    await dragHandle(page, imageAfter, 'left', -imageAfter.width, 0);
    await saveChanges();
    const restored = await read(imageId);
    expect(restored.width).toBeCloseTo(resized.width, 0);
    expect((restored.payload as ImageElementPayload).crop!.width).toBeCloseTo(1, 2);
    await expect.poll(async () => (await paintedColors(page)).red).toBeGreaterThan(100);
    await videoRow.getByRole('button', { name: 'Show layer' }).click();

    await page.locator('[data-ui-region="object-list-panel"]').getByText('Crop video fixture', { exact: true }).click();
    const originalVideo = await read(videoId);
    // Showing a hidden layer reloads its decoder; crop begins after the frame is ready.
    await expect.poll(() => page.locator('[data-ui-region="stage-panel"] canvas').first().evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const ratio = window.devicePixelRatio;
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      const scale = Math.min(width / 1920, height / 1080);
      const x = ((width - 1920 * scale) / 2 + 1200 * scale) * ratio;
      const y = ((height - 1080 * scale) / 2 + 300 * scale) * ratio;
      const pixel = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
      return pixel[0] < 15 && pixel[1] < 15 && pixel[2] > 240;
    })).toBe(true);
    await page.screenshot({ path: 'test-results/media-crop-video-before.png' });
    // Corners retain the frame ratio; video cover pixels remain at their original scale.
    await dragHandle(page, originalVideo, 'bottom-right', -100, -100);
    await saveChanges();
    const videoAfter = await read(videoId);
    const videoPayload = videoAfter.payload as VideoElementPayload;
    expect(videoPayload).toMatchObject({ autoplay: false, loop: true, muted: false, playbackRate: 1.25 });
    expect(videoAfter.width).toBeCloseTo(300, 0);
    expect(videoAfter.height).toBeCloseTo(300, 0);
    expect(videoPayload.crop!.x).toBeCloseTo(videoFit === 'cover' ? 0.25 : 0, 2);
    expect(videoPayload.crop!.width).toBeCloseTo(videoFit === 'cover' ? 0.375 : 0.75, 2);
    expect(videoPayload.crop!.height).toBeCloseTo(videoFit === 'cover' ? 0.75 : 1, 2);
    if (videoFit === 'contain') {
      expect(videoPayload.cropFrame!.y).toBeCloseTo(1 / 3, 2);
      expect(videoPayload.cropFrame!.height).toBeCloseTo(2 / 3, 2);
    }
    // Top handles affect only height.
    await dragHandle(page, videoAfter, 'top', 0, 50);
    await saveChanges();
    const videoTop = await read(videoId);
    expect(videoTop.width).toBeCloseTo(videoAfter.width, 0);
    // Native pointer coordinates round to screen pixels at this viewport scale.
    expect(Math.abs(videoTop.y - (videoAfter.y + 50))).toBeLessThan(2);
    expect(Math.abs(videoTop.height - 250)).toBeLessThan(2);
    if (videoFit === 'contain') {
      const afterTop = videoTop.payload as VideoElementPayload;
      expect(afterTop.crop!.height).toBeCloseTo(1, 2);
      expect(afterTop.cropFrame!.y).toBeCloseTo(0.2, 2);
      expect(afterTop.cropFrame!.height).toBeCloseTo(0.8, 2);
    }
    await page.screenshot({ path: `test-results/media-crop-${videoFit}-editor.png` });
    await app.close();
    app = await launch();
    const relaunchedPage = await app.firstWindow();
    await relaunchedPage.locator('[data-ui-region="app-toolbar"]').waitFor();
    const persisted = await relaunchedPage.evaluate(() => window.castApi.getSnapshot());
    expect(persisted.slideElements.find((entry) => entry.id === imageId)).toMatchObject({ x: restored.x, width: restored.width, payload: restored.payload });
    expect(persisted.slideElements.find((entry) => entry.id === videoId)).toMatchObject({ x: videoTop.x, y: videoTop.y, width: videoTop.width, height: videoTop.height, payload: videoTop.payload });
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

}

// Optional, source-derived end-to-end script. It drives a real built app: the
// window, the drag-free import path, exports, and the loopback MCP surface
// (including the 401 without a token). It is NOT part of `npm run build` and
// nothing runs it automatically — execute it deliberately from this app's
// directory after a build:
//
//   npm run build --workspace apps/flux
//   node apps/flux/e2e/flux-e2e.mjs
//
// It resolves Electron from apps/flux rather than whatever `electron` is on
// PATH, so it launches the same build this app ships and never a different
// Electron left behind by another app in the workspace.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  mkdtemp,
  mkdir,
  link,
  copyFile,
  readFile,
  writeFile,
  rename,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stage = (label, details) => {
  const entry = { at: new Date().toISOString(), label, ...(details ? { details } : {}) };
  evidence.stages.push(entry);
  persistEvidence();
  console.log(`[E2E] ${label}${details ? ` ${JSON.stringify(details)}` : ""}`);
};
async function pollPage(page, description, predicate, argument, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < end) {
    lastValue = await page.evaluate(predicate, argument);
    if (lastValue) return lastValue;
    await sleep(80);
  }
  throw new Error(
    `Timed out waiting for ${description}; last value: ${JSON.stringify(lastValue)}`,
  );
}
const require = createRequire(import.meta.url);
// apps/flux/e2e -> apps/flux, so this resolves the app-local (or, in a
// workspace, correctly hoisted) electron package.
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = appDir;
const localElectron = require("electron");
const temp = await mkdtemp(path.join(tmpdir(), "lumaflux-e2e-"));
await mkdir(path.join(temp, "exports"));
const outputDir = path.join(appDir, "output", "playwright");
await mkdir(outputDir, { recursive: true });
const resultsPath = path.join(outputDir, "results.json");
const timings = {};
const screenshots = [];
const evidence = { status: "running", timings, screenshots, stages: [] };
let activePage = null;
let compactOverflow = false;
let compactDiagnostics = null;
function persistEvidence() {
  writeFileSync(resultsPath, JSON.stringify(evidence, null, 2));
}
async function screenshot(page, name) {
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file });
  screenshots.push(file);
  persistEvidence();
}
async function captureFailure(page, error) {
  evidence.status = "failed";
  evidence.error = {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    stack: error?.stack,
  };
  if (page) {
    try {
      await screenshot(page, "failure");
    } catch {}
  }
  persistEvidence();
}
process.on("uncaughtExceptionMonitor", (error) => {
  evidence.status = "failed";
  evidence.error = {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    stack: error?.stack,
  };
  persistEvidence();
});
const source = path.join(temp, "color-study.png"),
  source2 = path.join(temp, "warm-study.png");
const pixels = Buffer.alloc(1200 * 800 * 3);
for (let y = 0; y < 800; y++)
  for (let x = 0; x < 1200; x++) {
    const i = (y * 1200 + x) * 3;
    pixels[i] = Math.round((x / 1200) * 220 + 20);
    pixels[i + 1] = Math.round((y / 800) * 190 + 30);
    pixels[i + 2] = Math.round((1 - x / 1200) * 160 + 30);
  }
await sharp(pixels, { raw: { width: 1200, height: 800, channels: 3 } })
  .withExif({
    IFD0: { Make: "Canon", Model: "Canon EOS 5D Mark II" },
    IFD2: {
      LensModel: "Canon EF 50mm f/1.8 II",
      FocalLength: "50/1",
      FNumber: "4/1",
    },
  })
  .png()
  .toFile(source);
await sharp(pixels, { raw: { width: 1200, height: 800, channels: 3 } })
  .modulate({ hue: 55 })
  .png()
  .toFile(source2);
const original = await readFile(source);
const sandboxArgs =
  process.env.LUMAFLUX_E2E_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
const launchOptions = {
  ...(process.env.LUMAFLUX_EXECUTABLE
    ? { executablePath: process.env.LUMAFLUX_EXECUTABLE, args: sandboxArgs }
    : { executablePath: localElectron, args: [root, ...sandboxArgs] }),
  env: { ...process.env, LUMAFLUX_DATA_DIR: path.join(temp, "data") },
  timeout: 30000,
};
const startupStarted = performance.now();
const app = await electron.launch(launchOptions);
let client;
let stdioClient;
try {
  const page = await app.firstWindow();
  activePage = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("A little room for your photos.").waitFor();
  timings.startupMs = Math.round(performance.now() - startupStarted);
  stage("empty catalog ready", { startupMs: timings.startupMs });
  const initialAgent = await page.evaluate(() => window.lumaflux.settings());
  assert.equal(initialAgent.enabled, true);
  assert.deepEqual(initialAgent.roots, []);
  assert.ok(initialAgent.endpoint);
  assert.equal(
    (await fetch(initialAgent.endpoint, { method: "POST" })).status,
    401,
  );
  const stillEnabled = await page.evaluate(() =>
    window.lumaflux.updateSettings(false, []),
  );
  assert.equal(stillEnabled.enabled, true);
  assert.ok(stillEnabled.endpoint);
  await screenshot(page, "empty");
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page
    .getByRole("button", { name: "Import photos", exact: true })
    .first()
    .click();
  assert.equal(
    await page.evaluate(async () =>
      (await window.lumaflux.command("get_app_state")).photos.length,
    ),
    0,
    "cancelling the native import dialog must leave the catalog empty",
  );
  await page.getByRole("button", { name: "Explore folders", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Parent folder", exact: true }).count(), 0);
  const importStarted = performance.now();
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
    },
    [source, source2],
  );
  await page
    .getByRole("button", { name: "Import photos", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Select color-study.png", exact: true })
    .waitFor();
  await pollPage(page, "imported thumbnails", () =>
    Array.from(document.querySelectorAll(".photo-image img")).every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  timings.importMs = Math.round(performance.now() - importStarted);
  stage("two-photo import and thumbnails ready", { importMs: timings.importMs });
  const search = page.getByRole("searchbox", { name: "Search photos" });
  await search.fill("warm-study");
  assert.equal(await page.locator(".photo-tile").count(), 1);
  await search.fill("does-not-exist");
  await page.getByText("No matching photos", { exact: true }).waitFor();
  assert.equal(await page.locator(".photo-tile").count(), 0);
  await search.fill("");
  assert.equal(await page.locator(".photo-tile").count(), 2);
  assert.equal(await page.locator(".inspector-shell").count(), 0);
  assert.equal(await page.getByRole("complementary").count(), 1);
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole("button", { name: "Explore folders", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Parent folder", exact: true }).count(), 0);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, temp);
  await page
    .getByRole("button", { name: "Explore folders", exact: true })
    .click();
  await page.getByRole("button", { name: "exports", exact: true }).click();
  await page
    .getByRole("button", { name: "Parent folder", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import this folder", exact: true })
    .waitFor();
  const left = await page.getByRole("complementary").boundingBox();
  await page.getByRole("separator", { name: "Resize sidebar" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.ok(
    (await page.getByRole("complementary").boundingBox()).width > left.width,
  );
  await screenshot(page, "gallery");
  await page
    .getByRole("button", { name: "Favorite color-study.png", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rate color-study.png 5", exact: true })
    .click();
  const minRating = page.getByRole("combobox", { name: "Minimum rating" });
  await minRating.click();
  await page.getByRole("option", { name: "5+ stars", exact: true }).click();
  assert.equal(await page.locator(".photo-tile").count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "Select color-study.png", exact: true }).count(),
    1,
  );
  await minRating.click();
  await page.getByRole("option", { name: "All ratings", exact: true }).click();
  assert.equal(await page.locator(".photo-tile").count(), 2);
  await page.getByRole("button", { name: "Select color-study.png", exact: true }).click();
  await pollPage(page, "select one photo", async () =>
    (await window.lumaflux.command("get_app_state")).selection.length === 1,
  );
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await pollPage(page, "select all visible photos", async () =>
    (await window.lumaflux.command("get_app_state")).selection.length === 2,
  );
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await pollPage(page, "clear photo selection", async () =>
    (await window.lumaflux.command("get_app_state")).selection.length === 0,
  );
  stage("search, rating filter, and selection flows passed");
  await page
    .getByRole("button", { name: "Select color-study.png", exact: true })
    .dblclick();
  await page.locator(".image-wrap img").waitFor();
  const navigationStarted = performance.now();
  await page.getByRole("button", { name: "Next photo", exact: true }).click();
  await pollPage(page, "next photo preview", () =>
    document.querySelector(".image-wrap img")?.alt === "warm-study.png",
  );
  await page.getByRole("button", { name: "Previous photo", exact: true }).click();
  await pollPage(page, "previous photo preview", () =>
    document.querySelector(".image-wrap img")?.alt === "color-study.png",
  );
  timings.navigationMs = Math.round(performance.now() - navigationStarted);
  stage("editor navigation ready", { navigationMs: timings.navigationMs });
  assert.equal(await page.getByRole("button", { name: "Previous photo", exact: true }).isDisabled(), true);
  assert.equal(
    await page
      .getByRole("toolbar", { name: "Viewer tools" })
      .getByRole("button", { name: "Undo", exact: true })
      .count(),
    1,
  );
  assert.equal(await page.getByText("File information", { exact: true }).count(), 0);
  await page.locator('.histogram-plot path[data-channel="red"]').waitFor();
  const histBox = await page.locator(".histogram-panel").boundingBox();
  const tabsBox = await page.getByRole("tablist").boundingBox();
  assert.ok(histBox.y + histBox.height <= tabsBox.y + 1);
  const graphBefore = await page
    .locator('.histogram-plot path[data-channel="red"]')
    .getAttribute("d");
  await page
    .getByRole("slider", { name: "Histogram Exposure", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await pollPage(page, "histogram after exposure keyboard edit", (before) =>
      document
        .querySelector('.histogram-plot path[data-channel="red"]')
        ?.getAttribute("d") !== before,
    graphBefore,
  );
  const histSlider = await page
    .getByRole("slider", { name: "Histogram Exposure", exact: true })
    .boundingBox();
  await pollPage(page, "histogram exposure slider enabled", () => {
    const slider = document.querySelector('[aria-label="Histogram Exposure"]');
    return !!slider && !slider.hasAttribute("disabled");
  });
  await page.mouse.move(
    histSlider.x + histSlider.width / 2,
    histSlider.y + histSlider.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    histSlider.x + histSlider.width / 2 + 8,
    histSlider.y + histSlider.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Highlight clipping", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Highlight clipping", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", { name: "Highlight clipping", exact: true })
    .click();
  await page.keyboard.press("j");
  assert.equal(
    await page
      .getByRole("button", { name: "Shadow clipping", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await pollPage(page, "shadow clipping overlay", () => {
    const canvas = document.querySelector(".clipping-overlay");
    return (
      canvas &&
      canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((v, i) => i % 4 === 3 && v > 0)
    );
  });
  await page.keyboard.press("j");
  const imageBox = await page.locator(".image-wrap img").boundingBox();
  await page.mouse.move(
    imageBox.x + imageBox.width / 2,
    imageBox.y + imageBox.height / 2,
  );
  await page.locator(".rgb-readout").waitFor();
  await screenshot(page, "histogram");
  const right = await page.locator(".inspector-shell").boundingBox();
  await page.getByRole("separator", { name: "Resize right panel" }).focus();
  await page.keyboard.press("ArrowLeft");
  assert.ok(
    (await page.locator(".inspector-shell").boundingBox()).width > right.width,
  );
  await page.getByRole("tab", { name: "Info", exact: true }).click();
  await page.getByText("File information", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("slider", { name: "Exposure", exact: true }).count(),
    0,
  );
  await page.getByRole("tab", { name: "Adjustments", exact: true }).click();
  await page.getByRole("slider", { name: "Exposure", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const exposureStarted = performance.now();
  await pollPage(page, "exposure edit persisted", async () => {
      const s = await window.lumaflux.command("get_app_state");
      return (
        s.photos.find((p) => p.name === "color-study.png").recipe.exposure > 0
      );
  });
  await pollPage(page, "updated exposure preview", () =>
    !!document.querySelector(".image-wrap img") &&
    !document.querySelector(".canvas-status"),
  );
  timings.editPreviewMs = Math.round(performance.now() - exposureStarted);
  const previousPreview = await page
    .locator(".image-wrap img")
    .getAttribute("src");
  const track = await page
    .locator(".adjustment")
    .first()
    .locator(".touch-none")
    .boundingBox();
  await page.mouse.move(
    track.x + track.width * 0.51,
    track.y + track.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    track.x + track.width * 0.6,
    track.y + track.height / 2,
    { steps: 12 },
  );
  await pollPage(
    page,
    "new preview frame after slider drag",
    (previous) => document.querySelector(".image-wrap img")?.src !== previous,
    previousPreview,
  );
  await page.mouse.up();
  await pollPage(page, "slider preview settle", () => !document.querySelector(".canvas-status"));
  let state = await page.evaluate(() =>
    window.lumaflux.command("get_app_state"),
  );
  const id = state.photos.find((p) => p.name === "color-study.png").id;
  assert.equal(await page.getByRole("complementary").count(), 0);
  assert.equal(await page.getByRole("toolbar", { name: "Library" }).count(), 0);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page
    .getByRole("slider", { name: "Luminance noise", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await pollPage(
    page,
    "luminance noise persisted",
    async (id) =>
      (await window.lumaflux.command("get_photo", { id })).recipe
        .noiseLuminance > 0,
    id,
  );
  await pollPage(page, "color noise slider enabled", () => {
    const slider = document.querySelector('[aria-label="Color noise"]');
    return !!slider && slider.getAttribute("aria-disabled") !== "true";
  });
  await page.getByRole("slider", { name: "Color noise", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await pollPage(
    page,
    "color noise persisted",
    async (id) =>
      (await window.lumaflux.command("get_photo", { id })).recipe.noiseColor >
      0,
    id,
  );
  await screenshot(page, "denoising");
  await page.getByRole("button", { name: "Auto light", exact: true }).click();
  await pollPage(page, "auto light operation settled", () => {
    const button = document.querySelector('button[aria-label="Auto light"]');
    return !!button && !button.disabled;
  });
  await screenshot(page, "auto-light");
  await page.getByRole("tab", { name: "Composition", exact: true }).click();
  await page
    .getByRole("button", { name: "Auto lens correction", exact: true })
    .click();
  await pollPage(page, "lens profile persisted", async () =>
    (await window.lumaflux.command("get_app_state")).photos.some(
      (p) => !!p.recipe.lensProfile,
    ),
  );
  await page
    .getByRole("button", { name: "Remove profile", exact: true })
    .waitFor();
  await screenshot(page, "auto-lens");
  await page
    .getByRole("button", { name: "Remove profile", exact: true })
    .click();
  await pollPage(page, "lens profile removed", async () =>
    (await window.lumaflux.command("get_app_state")).photos.every(
      (p) => !p.recipe.lensProfile,
    ),
  );

  await pollPage(page, "distortion slider enabled", () => {
    const slider = document.querySelector('[aria-label="Distortion"]');
    return !!slider && slider.getAttribute("aria-disabled") !== "true";
  });
  await page.getByRole("slider", { name: "Distortion", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await pollPage(
    page,
    "lens distortion persisted",
    async (id) =>
      (await window.lumaflux.command("get_photo", { id })).recipe
        .lensDistortion > 0,
    id,
  );
  await screenshot(page, "lens-correction");
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await pollPage(
    page,
    "rotation persisted",
    async (id) =>
      (await window.lumaflux.command("get_photo", { id })).recipe.rotation ===
      1,
    id,
  );
  await page.getByRole("checkbox", { name: "Lock aspect ratio" }).check();
  await pollPage(page, "rotated preview ready", () => {
    const img = document.querySelector(".image-wrap img");
    return !!img?.complete && img.naturalWidth > 0 && !document.querySelector(".canvas-status");
  });
  const image = await page.locator(".image-wrap img").boundingBox();
  assert.ok(image && image.width > 0);
  await page.mouse.move(image.x + image.width, image.y + image.height);
  await page.mouse.down();
  await page.mouse.move(
    image.x + image.width * 0.8,
    image.y + image.height * 0.8,
    { steps: 5 },
  );
  await page.mouse.up();

  await pollPage(
    page,
    "crop persisted",
    async (id) =>
      !!(await window.lumaflux.command("get_photo", { id })).recipe.crop,
    id,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await pollPage(
    page,
    "crop undo persisted",
    async (id) =>
      (await window.lumaflux.command("get_photo", { id })).recipe.crop === null,
    id,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await pollPage(
    page,
    "crop redo persisted",
    async (id) =>
      !!(await window.lumaflux.command("get_photo", { id })).recipe.crop,
    id,
  );
  await screenshot(page, "composition");
  await page.getByRole("slider", { name: "Straighten", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await pollPage(
    page,
    "straighten persisted",
    async (id) =>
      (await window.lumaflux.command("get_photo", { id })).recipe.straighten >
      0,
    id,
  );
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.locator(".compare-pane figcaption").waitFor();
  await pollPage(page, "comparison images loaded", () => {
    const images = [...document.querySelectorAll(".compare-pane img")];
    return images.length === 2 &&
      images.every((img) => img.complete && img.naturalWidth > 0) &&
      images[0].src !== images[1].src;
  });
  await screenshot(page, "compare");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByRole("tab", { name: "Adjustments", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "1:1", exact: true }).click();
  await pollPage(page, "1:1 zoom reached native pixel size", () => {
    const img = document.querySelector(".image-wrap img");
    return (
      img && Math.abs(img.getBoundingClientRect().width - img.naturalWidth) < 2
    );
  });
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await pollPage(page, "fit preview settled", () => !document.querySelector(".canvas-status"));
  await screenshot(page, "editor");
  stage("editing, history, crop, compare, and zoom flows passed", {
    editPreviewMs: timings.editPreviewMs,
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1060, 700),
  );
  await pollPage(page, "compact viewport applied", () =>
    window.innerWidth <= 1060 && window.innerHeight <= 700,
  );
  const compactMetrics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    boxes: Object.fromEntries(
      [
        "html",
        "body",
        "#root",
        ".app",
        ".workspace",
        ".main-area",
        ".viewer",
        ".canvas",
        ".filmstrip",
        ".inspector-shell",
        'footer[aria-label="Flux status"]',
      ].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [selector, {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        }];
      }),
    ),
    overflowAncestors: Object.fromEntries(
      ["html", "body", "#root", "#overlay-root", ".app", ".workspace", ".main-area", ".viewer", ".canvas"].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const style = getComputedStyle(element);
        return [selector, {
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }];
      }),
    ),
    bodyChildren: [...document.body.children].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: element.className?.toString().slice(0, 100),
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        position: style.position,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        html: element.outerHTML.slice(0, 220),
      };
    }),
    htmlPseudoElements: Object.fromEntries(["::before", "::after"].map((pseudo) => {
      const style = getComputedStyle(document.documentElement, pseudo);
      return [pseudo, {
        content: style.content,
        position: style.position,
        top: style.top,
        bottom: style.bottom,
        height: style.height,
      }];
    })),
    belowViewport: [...document.body.querySelectorAll("*")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || rect.bottom <= window.innerHeight + 1) return null;
        let scrollContainer = null;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (["auto", "scroll"].includes(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
            scrollContainer = parent.className?.toString() || parent.tagName.toLowerCase();
            break;
          }
        }
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className?.toString().slice(0, 100),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          scrollContainer,
          html: element.outerHTML.slice(0, 180),
        };
      })
      .filter(Boolean)
      .slice(0, 20),
    uncontainedBelowViewport: [...document.body.querySelectorAll("*")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || rect.bottom <= window.innerHeight + 1) return null;
        let scrollContainer = null;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (["auto", "scroll"].includes(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
            scrollContainer = parent.className?.toString() || parent.tagName.toLowerCase();
            break;
          }
        }
        if (scrollContainer) return null;
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className?.toString().slice(0, 100),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          overflowY: getComputedStyle(element).overflowY,
          html: element.outerHTML.slice(0, 180),
        };
      })
      .filter(Boolean)
      .slice(0, 12),
  }));
  await screenshot(page, "compact");
  await page.evaluate(() => window.scrollTo(0, 0));
  const baselineScrollY = await page.evaluate(() => {
    window.scrollTo(0, 100);
    return window.scrollY;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  const sourceBodyOverflowY = await page.evaluate(
    () => getComputedStyle(document.body).overflowY,
  );
  const internalScrollProbe = await page.evaluate(() => {
    const status = document.querySelector('footer[aria-label="Flux status"]');
    const statusBefore = status?.getBoundingClientRect();
    const scroller = document.querySelector(".inspector-shell .overflow-auto");
    const inspectorBefore = scroller?.scrollTop ?? null;
    if (scroller) scroller.scrollTop = Math.min(scroller.scrollHeight - scroller.clientHeight, 100);
    const inspectorAfter = scroller?.scrollTop ?? null;
    if (scroller) scroller.scrollTop = inspectorBefore ?? 0;
    const statusAfter = status?.getBoundingClientRect();
    return {
      pageScrollY: window.scrollY,
      inspectorBefore,
      inspectorAfter,
      statusBefore: statusBefore ? { top: statusBefore.top, bottom: statusBefore.bottom } : null,
      statusAfter: statusAfter ? { top: statusAfter.top, bottom: statusAfter.bottom } : null,
      htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  const innerScrollers = await page.evaluate(() =>
    [...document.body.querySelectorAll("*")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return ["auto", "scroll"].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 1;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className?.toString().slice(0, 100),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowY: getComputedStyle(element).overflowY,
        };
      })
      .slice(0, 20),
  );
  compactDiagnostics = {
    ...compactMetrics,
    sourceBodyOverflowY,
    baselineScrollY,
    internalScrollProbe,
    innerScrollers,
  };
  compactOverflow =
    baselineScrollY > 0 ||
    internalScrollProbe.inspectorAfter <= internalScrollProbe.inspectorBefore ||
    JSON.stringify(internalScrollProbe.statusBefore) !==
      JSON.stringify(internalScrollProbe.statusAfter);
  evidence.compactDiagnostics = compactDiagnostics;
  stage("compact viewport diagnostics", compactDiagnostics);
  assert.ok(
    compactMetrics.document.width <= compactMetrics.viewport.width,
    `compact layout overflow: ${JSON.stringify(compactMetrics)}`,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  await pollPage(page, "large viewport restored", () =>
    window.innerWidth >= 1400 && window.innerHeight >= 900,
  );
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, temp);
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await page.getByText("Agent access is always on", { exact: true }).waitFor();
  const connection = JSON.parse(
    await readFile(path.join(temp, "data", "mcp-connection.json"), "utf8"),
  );
  client = new Client({ name: "desktop-smoke", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.url), {
      requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
    }),
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  state = await page.evaluate(() => window.lumaflux.command("get_app_state"));
  const p = state.photos.find((p) => p.id === id);
  const edited = await client.callTool({
    name: "apply_edits",
    arguments: { id, expectedRevision: p.revision, patch: { saturation: -50 } },
  });
  assert.ok(!edited.isError);
  await page
    .getByRole("slider", { name: "Saturation", exact: true })
    .scrollIntoViewIfNeeded();
  await pollPage(page, "external saturation edit reflected in inspector", () =>
    document.querySelector('input[aria-label="Saturation"]')?.value === "-50",
  );
  const settings = await page.evaluate(() => window.lumaflux.settings());
  const bridge = JSON.parse(settings.clientConfig).mcpServers.lumaflux;
  stdioClient = new Client({ name: "stdio-smoke", version: "1" });
  await stdioClient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: bridge.args,
      cwd: temp,
    }),
  );
  assert.ok(
    (await stdioClient.listTools()).tools.some((t) => t.name === "get_preview"),
  );
  const visual = await stdioClient.callTool({
    name: "get_preview",
    arguments: { id, maxDimension: 400 },
  });
  assert.ok(visual.content.some((c) => c.type === "image"));
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.locator(".filmstrip button").nth(1).click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await pollPage(page, "pasted recipe persisted to second photo", async () => {
    const s = await window.lumaflux.command("get_app_state");
    return s.photos.find((p) => p.name === "warm-study.png").recipe.saturation === -50;
  });
  const pasted = await page.evaluate(async () => {
    const s = await window.lumaflux.command("get_app_state");
    return s.photos.find((p) => p.name === "warm-study.png");
  });
  assert.equal(pasted.recipe.noiseLuminance, 1);
  assert.equal(pasted.recipe.noiseColor, 1);
  assert.equal(pasted.recipe.lensDistortion, 0);
  assert.equal(pasted.recipe.rotation, 0);
  assert.equal(pasted.recipe.crop, null);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("button", { name: "Apply to selected", exact: true })
    .click();
  await pollPage(page, "sync edits applied to selected photos", async () => {
    const s = await window.lumaflux.command("get_app_state");
    return s.photos.every((p) => p.recipe.saturation === -50);
  });
  await page.getByRole("button", { name: "Reset edits", exact: true }).click();
  await pollPage(page, "reset restores neutral recipe", async () => {
    const s = await window.lumaflux.command("get_app_state");
    const warm = s.photos.find((p) => p.name === "warm-study.png");
    return warm.recipe.saturation === 0 &&
      warm.recipe.exposure === 0 &&
      warm.recipe.noiseLuminance === 0 &&
      warm.recipe.crop === null;
  });
  await page.getByRole("button", { name: "Export (2)", exact: true }).click();
  await page.getByRole("heading", { name: "Export 2 photos", exact: true }).waitFor();
  const format = page.getByRole("combobox", { name: "Format" });
  await format.click();
  await page.getByRole("option", { name: "PNG", exact: true }).click();
  await format.click();
  await page.getByRole("option", { name: "JPEG", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await page.evaluate(async () => (await window.lumaflux.command("get_app_state")).jobs.length),
    0,
    "cancelling export configuration must not create a job",
  );
  await page.getByRole("button", { name: "Export (2)", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Export destination" })
    .fill(source);
  await page
    .getByRole("button", { name: "Export photos", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.evaluate(async () => (await window.lumaflux.command("get_app_state")).jobs.length),
    0,
    "invalid export destination must report an error without queueing a job",
  );
  await page.getByRole("textbox", { name: "Export destination" }).fill(path.join(temp, "exports"));
  const exportStarted = performance.now();
  await page
    .getByRole("button", { name: "Export photos", exact: true })
    .click();
  await pollPage(page, "export job completed", async () => {
    const s = await window.lumaflux.command("get_app_state");
    return s.jobs[0]?.status === "completed";
  });
  timings.exportMs = Math.round(performance.now() - exportStarted);
  stage("export cancellation, invalid destination, and success passed", { exportMs: timings.exportMs });
  state = await page.evaluate(() => window.lumaflux.command("get_app_state"));
  console.log("Export jobs", JSON.stringify(state.jobs));
  assert.equal(state.jobs[0].outputs.length, 2);
  assert.equal(state.jobs[0].errors.length, 0);
  for (const file of state.jobs[0].outputs)
    assert.equal((await sharp(file).metadata()).format, "jpeg");
  assert.deepEqual(await readFile(source), original);
  await page.getByRole("button", { name: "Export (2)", exact: true }).click();
  await page.getByRole("heading", { name: "Export 2 photos", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Export destination" }).fill(path.join(temp, "exports"));
  const pngFormat = page.getByRole("combobox", { name: "Format" });
  await pngFormat.click();
  await page.getByRole("option", { name: "PNG", exact: true }).click();
  assert.equal(await page.getByRole("spinbutton", { name: "Quality" }).isDisabled(), true);
  await page.getByRole("checkbox", { name: "Resize to maximum dimension" }).check();
  await page.getByRole("spinbutton", { name: "Longest edge (pixels)" }).fill("64");
  const pngExportStarted = performance.now();
  await page.getByRole("button", { name: "Export photos", exact: true }).click();
  await pollPage(page, "resized PNG export completed", async () => {
    const s = await window.lumaflux.command("get_app_state");
    return s.jobs[0]?.total === 2 && s.jobs[0]?.status === "completed";
  });
  timings.pngResizeExportMs = Math.round(performance.now() - pngExportStarted);
  state = await page.evaluate(() => window.lumaflux.command("get_app_state"));
  assert.equal(state.jobs[0].outputs.length, 2);
  assert.equal(state.jobs[0].errors.length, 0);
  for (const file of state.jobs[0].outputs) {
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, "png");
    assert.ok(Math.max(metadata.width, metadata.height) <= 64);
  }
  await page.getByRole("button", { name: "Export (2)", exact: true }).click();
  await page.getByRole("heading", { name: "Export 2 photos", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Export destination" }).fill(path.join(temp, "exports"));
  const webpFormat = page.getByRole("combobox", { name: "Format" });
  await webpFormat.click();
  await page.getByRole("option", { name: "WebP", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Quality" }).fill("75");
  const webpExportStarted = performance.now();
  await page.getByRole("button", { name: "Export photos", exact: true }).click();
  await pollPage(page, "quality-adjusted WebP export completed", async () => {
    const s = await window.lumaflux.command("get_app_state");
    return s.jobs[0]?.total === 2 && s.jobs[0]?.status === "completed";
  });
  timings.webpQualityExportMs = Math.round(performance.now() - webpExportStarted);
  state = await page.evaluate(() => window.lumaflux.command("get_app_state"));
  assert.equal(state.jobs[0].outputs.length, 2);
  assert.equal(state.jobs[0].errors.length, 0);
  for (const file of state.jobs[0].outputs)
    assert.equal((await sharp(file).metadata()).format, "webp");
  assert.deepEqual(await readFile(source), original);
  stage("JPEG, resized PNG, and quality-adjusted WebP exports passed", {
    jpegMs: timings.exportMs,
    pngResizeMs: timings.pngResizeExportMs,
    webpQualityMs: timings.webpQualityExportMs,
  });
  assert.deepEqual(errors, []);
  await screenshot(page, "exports");
  console.log(
    JSON.stringify(
      {
        passed: !compactOverflow,
        temp,
        photos: state.photos.length,
        timings,
        outputs: state.jobs[0].outputs,
        screenshots,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await captureFailure(activePage, error);
  throw error;
} finally {
  await stdioClient?.close();
  await client?.close();
  await app.close();
}

// Relaunch against the real persisted catalog, detect a moved original, then relink it through UI.
const relocated = path.join(temp, "relocated.png");
await rename(source, relocated);
// Migrate the old disabled setting and tolerate an unavailable saved folder.
await writeFile(
  path.join(temp, "data", "settings.json"),
  JSON.stringify({
    enabled: false,
    roots: [temp, path.join(temp, "missing-folder")],
  }),
);
const reopened = await electron.launch(launchOptions);
try {
  const page = await reopened.firstWindow();
  activePage = page;
  await page
    .getByRole("button", { name: "Select color-study.png", exact: true })
    .waitFor();
  const restoredAgent = await page.evaluate(() => window.lumaflux.settings());
  assert.equal(restoredAgent.enabled, true);
  assert.ok(restoredAgent.endpoint);
  // Saved roots are canonicalized: macOS /var aliases /private/var, and
  // Windows runners can expose a short (8.3) path through tmpdir().
  assert.deepEqual(restoredAgent.roots, [await realpath(temp)]);
  const emptyAgent = await page.evaluate(() =>
    window.lumaflux.updateSettings(true, []),
  );
  assert.equal(emptyAgent.enabled, true);
  assert.ok(emptyAgent.endpoint);
  const stored = await page.evaluate(() =>
    window.lumaflux.command("get_app_state"),
  );
  const photo = stored.photos.find((p) => p.name === "color-study.png");
  assert.equal(stored.photos.length, 2);
  assert.equal(photo.favorite, true);
  assert.equal(photo.rating, 5);
  assert.ok(photo.history.length > 0);
  assert.equal(photo.missing, true);
  await page
    .getByRole("button", { name: "Select color-study.png", exact: true })
    .dblclick();
  await reopened.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole("button", { name: "Relink original", exact: true }).click();
  const afterCancelledRelink = await page.evaluate(() => window.lumaflux.command("get_app_state"));
  assert.equal(
    afterCancelledRelink.photos.find((p) => p.name === "color-study.png").missing,
    true,
    "cancelling relink must leave the original marked missing",
  );
  await reopened.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, relocated);
  await page
    .getByRole("button", { name: "Relink original", exact: true })
    .click();
  await pollPage(page, "relinked original appears in catalog", async () => {
    const s = await window.lumaflux.command("get_app_state");
    return s.photos.some((p) => p.name === "relocated.png" && !p.missing);
  });
  stage("restart persistence, missing file, canceled relink, and relink passed");
  assert.deepEqual(await readFile(relocated), original);
  console.log(
    "Relaunch, persisted history/metadata, missing-file detection, and relink passed.",
  );
} catch (error) {
  await captureFailure(activePage, error);
  throw error;
} finally {
  await reopened.close();
}

// A separate real catalog measures the desktop at a representative library
// size.  Small hard-linked test images keep the scenario compact on disk while
// each path remains a distinct imported photo and catalog entry.
const runScale = !process.argv.includes("--core-only");
const scaleResults = {};
if (runScale) {
const scaleTemp = await mkdtemp(path.join(tmpdir(), "lumaflux-scale-e2e-"));
const scaleInput = path.join(scaleTemp, "photos");
const scaleSeedDir = path.join(scaleTemp, "seed");
await Promise.all([
  mkdir(scaleInput),
  mkdir(scaleSeedDir),
  mkdir(path.join(scaleTemp, "data")),
  mkdir(path.join(scaleTemp, "exports")),
]);
const scaleSeed = path.join(scaleSeedDir, "seed.png");
await sharp(Buffer.alloc(80 * 48 * 3, 128), {
  raw: { width: 80, height: 48, channels: 3 },
})
  .png()
  .toFile(scaleSeed);
const scalePaths = [];
for (let offset = 0; offset < 1000; offset += 100) {
  const batch = await Promise.all(
    Array.from({ length: 100 }, async (_, index) => {
      const filename = `scale-${String(offset + index).padStart(4, "0")}.png`;
      const destination = path.join(scaleInput, filename);
      await link(scaleSeed, destination).catch(() =>
        copyFile(scaleSeed, destination),
      );
      return destination;
    }),
  );
  scalePaths.push(...batch);
}
stage("1000 compact fixture paths created", { temp: scaleTemp });
const scaleLaunchOptions = {
  ...launchOptions,
  env: {
    ...launchOptions.env,
    LUMAFLUX_DATA_DIR: path.join(scaleTemp, "data"),
  },
};
const scaleApp = await electron.launch(scaleLaunchOptions);
try {
  const page = await scaleApp.firstWindow();
  activePage = page;
  await page.getByText("A little room for your photos.").waitFor();
  const importStarted = performance.now();
  stage("starting 1000-photo catalog import");
  for (let offset = 0; offset < scalePaths.length; offset += 500) {
    await page.evaluate(
      (paths) => window.lumaflux.command("import_photos", { paths }),
      scalePaths.slice(offset, offset + 500),
    );
  }
  await pollPage(page, "1000 imported photo records", async () =>
    (await window.lumaflux.command("get_app_state")).photos.length === 1000,
    undefined,
    60000,
  );
  await pollPage(
    page,
    "1000 rendered photo tiles",
    () => document.querySelectorAll(".photo-tile").length === 1000,
    undefined,
    60000,
  );
  scaleResults.importAndGalleryMs = Math.round(performance.now() - importStarted);
  await screenshot(page, "scale-gallery-1000");
  scaleResults.gallery = await page.evaluate(() => ({
    photoTiles: document.querySelectorAll(".photo-tile").length,
    domNodes: document.querySelectorAll("*").length,
    loadedThumbnails: [...document.querySelectorAll(".photo-image img")].filter(
      (img) => img.complete && img.naturalWidth > 0,
    ).length,
    usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
  }));
  stage("1000-photo catalog rendered", {
    importAndGalleryMs: scaleResults.importAndGalleryMs,
    ...scaleResults.gallery,
  });

  const search = page.getByRole("searchbox", { name: "Search photos" });
  const searchStarted = performance.now();
  await search.fill("scale-0999");
  await pollPage(
    page,
    "search narrows 1000 photos to one result",
    () => document.querySelectorAll(".photo-tile").length === 1,
    undefined,
    20000,
  );
  scaleResults.searchMs = Math.round(performance.now() - searchStarted);
  stage("1000-photo search passed", { searchMs: scaleResults.searchMs });
  await search.fill("");
  await pollPage(
    page,
    "all 1000 photos restored after search",
    () => document.querySelectorAll(".photo-tile").length === 1000,
    undefined,
    20000,
  );

  await page
    .getByRole("button", { name: "Select scale-0000.png", exact: true })
    .click();
  await pollPage(page, "first scale photo selected", async () =>
    (await window.lumaflux.command("get_app_state")).selection.length === 1,
  );
  const selectStarted = performance.now();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await pollPage(
    page,
    "select all 1000 photos",
    async () => (await window.lumaflux.command("get_app_state")).selection.length === 1000,
    undefined,
    30000,
  );
  scaleResults.selectAllMs = Math.round(performance.now() - selectStarted);
  stage("1000-photo select all passed", { selectAllMs: scaleResults.selectAllMs });

  const ratingStarted = performance.now();
  await page.getByRole("heading", { name: "All photos", exact: true }).click();
  await page.keyboard.press("2");
  await pollPage(
    page,
    "bulk rating applied to 1000 photos",
    async () => {
      const s = await window.lumaflux.command("get_app_state");
      return s.photos.length === 1000 && s.photos.every((photo) => photo.rating === 2);
    },
    undefined,
    30000,
  );
  scaleResults.bulkRatingMs = Math.round(performance.now() - ratingStarted);
  stage("1000-photo bulk rating passed", { bulkRatingMs: scaleResults.bulkRatingMs });

  const editorStarted = performance.now();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await pollPage(page, "first large-catalog editor preview ready", () => {
    const image = document.querySelector(".image-wrap img");
    return !!image?.complete && image.naturalWidth > 0 && !document.querySelector(".canvas-status");
  }, undefined, 30000);
  scaleResults.editorOpenMs = Math.round(performance.now() - editorStarted);
  scaleResults.editor = await page.evaluate(() => ({
    displayedPhoto: document.querySelector(".image-wrap img")?.alt ?? null,
    domNodes: document.querySelectorAll("*").length,
    usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
  }));
  stage("1000-photo editor opened", {
    editorOpenMs: scaleResults.editorOpenMs,
    ...scaleResults.editor,
  });
  const scalePhoto = await page.evaluate(async () => {
    const state = await window.lumaflux.command("get_app_state");
    return state.photos.find((photo) => photo.name === "scale-0000.png");
  });
  const scalePreviewBefore = await page.locator(".image-wrap img").getAttribute("src");
  const scaleEditStarted = performance.now();
  await page.getByRole("slider", { name: "Exposure", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await pollPage(
    page,
    "1000-photo exposure edit persisted",
    async (id) =>
      (await window.lumaflux.command("get_photo", { id })).recipe.exposure > 0,
    scalePhoto.id,
    30000,
  );
  await pollPage(
    page,
    "1000-photo preview refreshed",
    (previous) =>
      document.querySelector(".image-wrap img")?.src !== previous &&
      !document.querySelector(".canvas-status"),
    scalePreviewBefore,
    30000,
  );
  scaleResults.editPreviewMs = Math.round(performance.now() - scaleEditStarted);
  const editedScalePhoto = await page.evaluate(
    async (id) => window.lumaflux.command("get_photo", { id }),
    scalePhoto.id,
  );
  assert.ok(editedScalePhoto.recipe.exposure > 0);
  stage("1000-photo edit preview updated", { editPreviewMs: scaleResults.editPreviewMs });

  const scaleSyncStarted = performance.now();
  await page.getByRole("button", { name: "Apply to selected", exact: true }).click();
  await pollPage(
    page,
    "adjustments synced to 1000 photos",
    async (expectedExposure) => {
      const state = await window.lumaflux.command("get_app_state");
      return state.photos.length === 1000 &&
        state.photos.every((photo) => photo.recipe.exposure === expectedExposure);
    },
    editedScalePhoto.recipe.exposure,
    60000,
  );
  scaleResults.applyToSelectedMs = Math.round(performance.now() - scaleSyncStarted);
  stage("1000-photo apply-to-selected passed", { applyToSelectedMs: scaleResults.applyToSelectedMs });

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await pollPage(
    page,
    "large library restored after edit sync",
    () => document.querySelectorAll(".photo-tile").length === 1000,
    undefined,
    30000,
  );
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await pollPage(
    page,
    "1000 export targets selected",
    async () => (await window.lumaflux.command("get_app_state")).selection.length === 1000,
    undefined,
    30000,
  );
  await page.getByRole("button", { name: "Export (1000)", exact: true }).click();
  await page.getByRole("heading", { name: "Export 1000 photos", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Export destination" }).fill(path.join(scaleTemp, "exports"));
  await page.getByRole("checkbox", { name: "Resize to maximum dimension" }).check();
  await page.getByRole("spinbutton", { name: "Longest edge (pixels)" }).fill("64");
  const scaleExportStarted = performance.now();
  await page.getByRole("button", { name: "Export photos", exact: true }).click();
  await pollPage(
    page,
    "1000-photo export completed",
    async () => {
      const state = await window.lumaflux.command("get_app_state");
      return state.jobs[0]?.total === 1000 && state.jobs[0]?.status === "completed";
    },
    undefined,
    120000,
  );
  scaleResults.export1000Ms = Math.round(performance.now() - scaleExportStarted);
  const exportedScaleState = await page.evaluate(() => window.lumaflux.command("get_app_state"));
  const exportedScaleJob = exportedScaleState.jobs[0];
  assert.equal(exportedScaleJob.outputs.length, 1000);
  assert.equal(exportedScaleJob.errors.length, 0);
  const outputInfo = await sharp(exportedScaleJob.outputs[0]).metadata();
  assert.equal(outputInfo.format, "jpeg");
  assert.ok(Math.max(outputInfo.width, outputInfo.height) <= 64);
  assert.deepEqual(await readFile(scalePaths[0]), await readFile(scaleSeed));
  stage("1000-photo resized JPEG export passed", { export1000Ms: scaleResults.export1000Ms });
  await screenshot(page, "scale-editor-1000");
  console.log("1000-photo real-app scale scenario", JSON.stringify({ temp: scaleTemp, ...scaleResults }, null, 2));
} catch (error) {
  await captureFailure(activePage, error);
  throw error;
} finally {
  await scaleApp.close();
}
}

evidence.status = compactOverflow ? "failed" : "passed";
evidence.timings = { ...timings, ...scaleResults };
evidence.scale = { enabled: runScale, ...scaleResults };
evidence.compactDiagnostics = compactDiagnostics;
if (compactOverflow) {
  evidence.error = {
    name: "CompactLayoutOverflow",
    message: "The compact editor scroll boundary failed; see the saved viewport diagnostics.",
  };
  const failureShot = path.join(outputDir, "failure.png");
  await copyFile(path.join(outputDir, "compact.png"), failureShot);
  screenshots.push(failureShot);
}
persistEvidence();
assert.ok(
  !compactOverflow,
  "The compact editor document scrolls, the Adjustment panel cannot scroll internally, or the status footer moves; see results.json and compact.png.",
);

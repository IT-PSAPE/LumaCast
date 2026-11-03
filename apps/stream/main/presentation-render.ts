import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_PRESENTATION_BYTES = 50 * 1024 * 1024;
export const MAX_PRESENTATION_SLIDES = 100;
export const MAX_PRESENTATION_RENDER_DIMENSION = 1920;

export interface PresentationRenderRequest {
  sourcePath: string;
  outputDirectory: string;
  /** Extra-resource font directory in packaged builds; the package fonts work in development. */
  fontDirectory?: string;
}

export interface RenderedPresentationSlide {
  path: string;
  name: string;
}

export class PresentationRenderError extends Error {}

export async function validatePresentationFile(sourcePath: string): Promise<'pptx' | 'pdf'> {
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  if (extension !== 'pptx' && extension !== 'pdf') {
    throw new PresentationRenderError('Choose a PowerPoint (.pptx) or PDF presentation. Export Google Slides as either format first.');
  }
  const info = await lstat(sourcePath).catch(() => null);
  if (!info?.isFile() || info.size < 1) throw new PresentationRenderError('The selected presentation is empty or unavailable.');
  if (info.size > MAX_PRESENTATION_BYTES) throw new PresentationRenderError('Presentations must be 50 MB or smaller.');
  return extension;
}

function checkSlideCount(count: number): void {
  if (count < 1) throw new PresentationRenderError('The presentation has no slides.');
  if (count > MAX_PRESENTATION_SLIDES) throw new PresentationRenderError('Presentations can contain up to 100 slides.');
}

/** Fits the authored page inside a bounded raster without changing its aspect ratio. */
export function presentationRasterSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new PresentationRenderError('The presentation contains an invalid slide size.');
  }
  const scale = MAX_PRESENTATION_RENDER_DIMENSION / Math.max(width, height);
  const result = { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  if (Math.min(result.width, result.height) < 16) throw new PresentationRenderError('The presentation contains an unsupported slide size.');
  return result;
}

function outputSlide(outputDirectory: string, index: number): RenderedPresentationSlide {
  return { path: path.join(outputDirectory, `slide-${String(index + 1).padStart(3, '0')}.png`), name: `Slide ${index + 1}` };
}

async function renderPowerPoint(bytes: Buffer, request: PresentationRenderRequest): Promise<RenderedPresentationSlide[]> {
  const [pptx, preview] = await Promise.all([import('@office-kit/pptx'), import('@office-kit/pptx-preview/node')]);
  let presentation: Awaited<ReturnType<typeof pptx.loadPresentation>>;
  try {
    presentation = await pptx.loadPresentation(bytes, {
      limits: {
        maxEntries: 10_000,
        maxTotalUncompressedBytes: 200 * 1024 * 1024,
        maxXmlPartBytes: 10 * 1024 * 1024,
        maxTotalXmlBytes: 50 * 1024 * 1024,
      },
    });
  } catch {
    throw new PresentationRenderError('The PowerPoint file is invalid, protected, or exceeds the import limits. Try exporting it as a PDF.');
  }
  const slides = pptx.getSlides(presentation);
  checkSlideCount(slides.length);
  const authoredSize = pptx.getSlideSize(presentation);
  if (!authoredSize) throw new PresentationRenderError('The PowerPoint slide size is missing. Try exporting it as a PDF.');
  const size = presentationRasterSize(authoredSize.width, authoredSize.height);
  // Rust's font loader cannot read app.asar. Packaged builds supply the same
  // font faces staged outside it; Node's fontkit measurer remains asar-aware.
  const fontFiles = request.fontDirectory
    ? (await readdir(request.fontDirectory)).filter((file) => /\.(ttf|otf)$/i.test(file)).map((file) => path.join(request.fontDirectory!, file))
    : undefined;
  if (fontFiles && fontFiles.length === 0) throw new PresentationRenderError('Presentation fonts are unavailable. Reinstall LumaStream and try again.');
  const result: RenderedPresentationSlide[] = [];
  for (const [index, slide] of slides.entries()) {
    const svg = preview.renderSlideToSvg(presentation, slide, { textLayout: 'svg' });
    if (/\bdata-pptx-fallback\s*=/.test(svg)) {
      throw new PresentationRenderError('This PowerPoint contains unsupported or linked visuals. Export it as a PDF and import that file to preserve the slides.');
    }
    const image = preview.renderSlideToImage(presentation, slide, { width: size.width, fontFiles });
    const output = outputSlide(request.outputDirectory, index);
    await writeFile(output.path, image, { flag: 'wx' });
    result.push(output);
  }
  return result;
}

async function renderPdf(bytes: Buffer, request: PresentationRenderRequest): Promise<RenderedPresentationSlide[]> {
  const [{ PDFiumLibrary }, { default: sharp }] = await Promise.all([import('@hyzyla/pdfium'), import('sharp')]);
  // The Node entry reads its bundled WASM locally, including from app.asar.
  const library = await PDFiumLibrary.init();
  try {
    let document: Awaited<ReturnType<typeof library.loadDocument>>;
    try { document = await library.loadDocument(bytes); }
    catch { throw new PresentationRenderError('The PDF is invalid or password protected. Export an unprotected PDF and try again.'); }
    try {
      checkSlideCount(document.getPageCount());
      const result: RenderedPresentationSlide[] = [];
      for (const page of document.pages()) {
        try {
          const authored = page.getOriginalSize();
          const size = presentationRasterSize(authored.originalWidth, authored.originalHeight);
          const image = await page.render({
            ...size,
            renderFormFields: false,
            render: async ({ width, height, data }) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer(),
          });
          const output = outputSlide(request.outputDirectory, page.number);
          await writeFile(output.path, image.data, { flag: 'wx' });
          result.push(output);
        } finally { page.close(); }
      }
      return result;
    } finally { document.destroy(); }
  } finally { library.destroy(); }
}

/** Worker-only conversion. The caller owns and removes the temporary directory. */
export async function renderPresentation(request: PresentationRenderRequest): Promise<RenderedPresentationSlide[]> {
  const extension = await validatePresentationFile(request.sourcePath);
  const bytes = await readFile(request.sourcePath);
  if (bytes.byteLength > MAX_PRESENTATION_BYTES) throw new PresentationRenderError('Presentations must be 50 MB or smaller.');
  await mkdir(request.outputDirectory, { recursive: true });
  try {
    return extension === 'pptx' ? await renderPowerPoint(bytes, request) : await renderPdf(bytes, request);
  } catch (error) {
    if (error instanceof PresentationRenderError) throw error;
    throw new PresentationRenderError('The presentation could not be rendered. Try exporting a simplified PDF and importing it again.');
  }
}

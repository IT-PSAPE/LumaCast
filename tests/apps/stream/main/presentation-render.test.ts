// @vitest-environment node
import { mkdtemp, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pptx from '@office-kit/pptx';
import sharp from 'sharp';
import { ZipFile } from 'yazl';
import { MAX_PRESENTATION_BYTES, presentationRasterSize, renderPresentation } from '../../../../apps/stream/main/presentation-render';

const temporaryDirectories: string[] = [];

interface ZipEntry { fileName: string }
interface ZipReader extends EventEmitter {
  readEntry(): void;
  openReadStream(entry: ZipEntry, callback: (error: Error | null, stream?: Readable) => void): void;
}

// Use Stream's declared ZIP reader, independent of Electron's transitive packages.
const streamRequire = createRequire(new URL('../../../../apps/stream/package.json', import.meta.url));
const { fromBuffer } = streamRequire('yauzl') as {
  fromBuffer(bytes: Buffer, options: { lazyEntries: boolean }, callback: (error: Error | null, reader?: ZipReader) => void): void;
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(extension: string, bytes: Uint8Array | string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lumastream-presentation-render-'));
  temporaryDirectories.push(root);
  const sourcePath = path.join(root, `presentation.${extension}`);
  const outputDirectory = path.join(root, 'slides');
  await writeFile(sourcePath, bytes);
  return { sourcePath, outputDirectory };
}

async function powerPoint(slideCount = 3): Promise<Uint8Array> {
  const presentation = pptx.createPresentation({ size: '16:9' });
  const image = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#111111' } }).png().toBuffer();
  for (let index = 0; index < slideCount; index += 1) {
    const slide = pptx.addBlankSlide(presentation);
    pptx.setSlideBackground(slide, (['#DD3333', '#33BB55', '#3366DD'] as const)[index % 3]!);
    const title = pptx.addSlideTextBox(slide, {
      x: pptx.inches(1), y: pptx.inches(0.8), w: pptx.inches(10), h: pptx.inches(1.5), text: `Slide ${index + 1}`,
    });
    pptx.setShapeTextFormat(title, { size: 36, color: '#FFFFFF' });
    const shape = pptx.addSlideShape(slide, { preset: 'ellipse', x: pptx.inches(1), y: pptx.inches(3), w: pptx.inches(2), h: pptx.inches(2) });
    pptx.setShapeFill(shape, '#F5CE49');
    pptx.addSlideImage(slide, image, { x: pptx.inches(7), y: pptx.inches(3), w: pptx.inches(2), h: pptx.inches(2) });
  }
  return pptx.savePresentation(presentation);
}

/** Small real PDF fixture with one colored page and visible title per slide. */
function pdf(pageCount = 3): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let index = 0; index < pageCount; index += 1) {
    const colors = ['0.8 0.2 0.2', '0.2 0.7 0.3', '0.2 0.4 0.8'];
    const stream = `${colors[index % 3]} rg 0 0 960 540 re f\n1 1 1 rg BT /F1 36 Tf 60 420 Td (Slide ${index + 1}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    );
  }
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

async function changeZip(bytes: Uint8Array, edit: (name: string, bytes: Buffer) => Buffer): Promise<Buffer> {
  const reader = await new Promise<ZipReader>((resolve, reject) => fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, zip) => error ? reject(error) : resolve(zip!)));
  const files: Array<[string, Buffer]> = [];
  await new Promise<void>((resolve, reject) => {
    reader.on('error', reject);
    reader.on('end', resolve);
    reader.on('entry', (entry: ZipEntry) => {
      reader.openReadStream(entry, (error, stream) => {
        if (error) { reject(error); return; }
        const chunks: Buffer[] = [];
        stream!.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream!.on('error', reject);
        stream!.on('end', () => { files.push([entry.fileName, edit(entry.fileName, Buffer.concat(chunks))]); reader.readEntry(); });
      });
    });
    reader.readEntry();
  });
  const writer = new ZipFile();
  for (const [name, bytes] of files) writer.addBuffer(bytes, name);
  writer.end();
  const chunks: Buffer[] = [];
  for await (const chunk of writer.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function pixel(filePath: string, left: number, top: number): Promise<number[]> {
  return [...await sharp(filePath).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
}

describe('Stream presentation conversion', () => {
  it('renders every PPTX slide in authored order with text, shapes and embedded images', async () => {
    const request = await fixture('pptx', await powerPoint());
    const slides = await renderPresentation(request);
    expect(slides.map(({ name }) => name)).toEqual(['Slide 1', 'Slide 2', 'Slide 3']);
    for (const slide of slides) expect(await sharp(slide.path).metadata()).toMatchObject({ format: 'png', width: 1920, height: 1080 });
    expect(await pixel(slides[0]!.path, 1800, 1000)).toEqual([221, 51, 51]);
    expect(await pixel(slides[1]!.path, 1800, 1000)).toEqual([51, 187, 85]);
    expect(await pixel(slides[2]!.path, 1800, 1000)).toEqual([51, 102, 221]);
    expect(await pixel(slides[0]!.path, 288, 576)).toEqual([245, 206, 73]);
    expect(await pixel(slides[0]!.path, 1100, 500)).toEqual([17, 17, 17]);
    expect(await readdir(request.outputDirectory)).toEqual(['slide-001.png', 'slide-002.png', 'slide-003.png']);
  });

  it('renders every PDF page offline without canvas, preserving page order and aspect ratio', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable'));
    const slides = await renderPresentation(await fixture('pdf', pdf()));
    expect(slides).toHaveLength(3);
    for (const slide of slides) expect(await sharp(slide.path).metadata()).toMatchObject({ width: 1920, height: 1080 });
    expect(await pixel(slides[0]!.path, 1800, 1000)).toEqual([204, 51, 51]);
    expect(await pixel(slides[1]!.path, 1800, 1000)).toEqual([51, 179, 77]);
    expect(await pixel(slides[2]!.path, 1800, 1000)).toEqual([51, 102, 204]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['pptx', 'pdf'])('rejects a malformed %s with an actionable message', async (extension) => {
    await expect(renderPresentation(await fixture(extension, 'not a presentation'))).rejects.toThrow(/invalid|protected/);
  });

  it('rejects unsupported file types and files larger than 50 MB before rendering', async () => {
    await expect(renderPresentation(await fixture('ppt', 'legacy file'))).rejects.toThrow('Choose a PowerPoint (.pptx) or PDF');
    const request = await fixture('pptx', 'x');
    await truncate(request.sourcePath, MAX_PRESENTATION_BYTES + 1);
    await expect(renderPresentation(request)).rejects.toThrow('50 MB');
    await expect(readdir(request.outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a PDF above the 100-slide limit before writing any pages', async () => {
    const request = await fixture('pdf', pdf(101));
    await expect(renderPresentation(request)).rejects.toThrow('up to 100 slides');
    expect(await readdir(request.outputDirectory)).toEqual([]);
  });

  it('rejects a declared oversized PPTX archive before expanding it', async () => {
    const bytes = Buffer.from(await powerPoint(1));
    const centralEntry = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralEntry).toBeGreaterThan(0);
    bytes.writeUInt32LE(201 * 1024 * 1024, centralEntry + 24);
    const request = await fixture('pptx', bytes);
    await expect(renderPresentation(request)).rejects.toThrow('exceeds the import limits');
    expect(await readdir(request.outputDirectory)).toEqual([]);
  });

  it('rejects linked images instead of fetching them or accepting an incomplete slide', async () => {
    const bytes = await changeZip(await powerPoint(1), (name, bytes) => {
      if (!name.endsWith('slides/_rels/slide1.xml.rels')) return bytes;
      return Buffer.from(bytes.toString('utf8').replace(/(<Relationship\b[^>]*Type="[^"]*\/image"[^>]*Target=")[^"]+("[^>]*\/?>)/, '$1http://127.0.0.1:1/private.png$2')
        .replace(/(<Relationship\b[^>]*Type="[^"]*\/image")/, '$1 TargetMode="External"'));
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Do not fetch external images'));
    const request = await fixture('pptx', bytes);
    await expect(renderPresentation(request)).rejects.toThrow('unsupported or linked visuals');
    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(request.outputDirectory)).toEqual([]);
  });
});

describe('presentation raster bounds', () => {
  it('preserves landscape and portrait aspect ratios within 1920 pixels', () => {
    expect(presentationRasterSize(960, 540)).toEqual({ width: 1920, height: 1080 });
    expect(presentationRasterSize(540, 960)).toEqual({ width: 1080, height: 1920 });
    expect(() => presentationRasterSize(0, 540)).toThrow('invalid slide size');
    expect(() => presentationRasterSize(Infinity, 540)).toThrow('invalid slide size');
    expect(() => presentationRasterSize(1, 100_000)).toThrow('unsupported slide size');
  });
});

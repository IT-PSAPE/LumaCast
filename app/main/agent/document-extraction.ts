import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
// `pdf-parse`'s package-root `index.js` runs a debug block (`!module.parent`)
// that reads a fixture PDF off disk whenever it is required in a context
// where `module.parent` is unset — true under bundlers/ESM interop, not just
// a plain CJS `require`. Importing the inner implementation module directly
// skips that file entirely. This must stay a static import (not a
// `createRequire` call) so tests can `vi.mock` it.
// @ts-expect-error pdf-parse ships type declarations only for its unused
// root `index.js`, not for this subpath; typed below by hand instead.
import pdfParseRaw from 'pdf-parse/lib/pdf-parse.js';

interface PdfParseInfo {
  Title?: string;
  [key: string]: unknown;
}

interface PdfParseResult {
  text: string;
  numpages: number;
  numrender: number;
  info: PdfParseInfo | null;
  metadata: unknown;
  version: string | null;
}

type PdfParseFn = (data: Buffer, options?: Record<string, unknown>) => Promise<PdfParseResult>;

const pdfParse = pdfParseRaw as PdfParseFn;

export type ExtractableDocumentKind = 'text' | 'markdown' | 'csv' | 'json' | 'pdf' | 'docx';

export const EXTRACTABLE_DOCUMENT_EXTENSIONS: Readonly<Record<string, ExtractableDocumentKind>> = {
  '.txt': 'text',
  '.text': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.csv': 'csv',
  '.json': 'json',
  '.pdf': 'pdf',
  '.docx': 'docx',
};

export function detectDocumentKind(filePath: string): ExtractableDocumentKind | null {
  const extension = path.extname(filePath).toLowerCase();
  return EXTRACTABLE_DOCUMENT_EXTENSIONS[extension] ?? null;
}

export interface DocumentExtractionOptions {
  /** Character budget for the returned text. Default 200,000. */
  maxChars?: number;
  /** Refuse to read files larger than this. Default 50 MiB. */
  maxFileBytes?: number;
}

export interface DocumentExtractionResult {
  kind: ExtractableDocumentKind;
  text: string;
  charCount: number;
  truncated: boolean;
  pageCount: number | null;
  title: string | null;
  fileName: string;
}

export type DocumentExtractionErrorCode = 'unsupported' | 'too-large' | 'unreadable' | 'parse-failed';

export class DocumentExtractionError extends Error {
  constructor(
    public readonly code: DocumentExtractionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}

const DEFAULT_MAX_CHARS = 200_000;
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Extracts plain text from a document already authorized for reading by a
 * separate path-authorization layer. This module is a pure extractor: it
 * never decides whether a path is allowed, only how to turn bytes at that
 * path into text.
 */
export async function extractDocumentText(
  filePath: string,
  options: DocumentExtractionOptions = {}
): Promise<DocumentExtractionResult> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const fileName = path.basename(filePath);

  const stats = await statOrUnreadable(filePath, fileName);
  if (!stats.isFile()) {
    throw new DocumentExtractionError('unreadable', `${fileName} is not a regular file`);
  }
  if (stats.size > maxFileBytes) {
    throw new DocumentExtractionError(
      'too-large',
      `${fileName} is ${stats.size} bytes, exceeding the ${maxFileBytes}-byte limit`
    );
  }

  const kind = detectDocumentKind(filePath);
  if (kind === null) {
    const extension = path.extname(filePath) || '(none)';
    throw new DocumentExtractionError('unsupported', `Unsupported file extension for ${fileName}: ${extension}`);
  }

  let text: string;
  let pageCount: number | null = null;
  let title: string | null = null;

  switch (kind) {
    case 'text':
    case 'markdown':
    case 'csv': {
      text = normalizeLineEndings(await readUtf8(filePath, fileName));
      break;
    }
    case 'json': {
      text = normalizeLineEndings(formatJsonOrRaw(await readUtf8(filePath, fileName)));
      break;
    }
    case 'pdf': {
      const extracted = await extractPdf(filePath, fileName);
      text = normalizeLineEndings(extracted.text);
      pageCount = extracted.pageCount;
      title = extracted.title;
      break;
    }
    case 'docx': {
      text = normalizeLineEndings(await extractDocx(filePath, fileName));
      break;
    }
  }

  const collapsed = collapseBlankLines(text);
  const truncatedResult = truncateOnLineBoundary(collapsed, maxChars);

  return {
    kind,
    text: truncatedResult.text,
    charCount: truncatedResult.text.length,
    truncated: truncatedResult.truncated,
    pageCount,
    title,
    fileName,
  };
}

async function statOrUnreadable(filePath: string, fileName: string) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    throw new DocumentExtractionError('unreadable', `Could not read ${fileName}: ${errorMessage(error)}`);
  }
}

async function readUtf8(filePath: string, fileName: string): Promise<string> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    throw new DocumentExtractionError('unreadable', `Could not read ${fileName}: ${errorMessage(error)}`);
  }
  return stripBom(buffer.toString('utf8'));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function formatJsonOrRaw(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

/** Collapses runs of 3+ blank lines (4+ consecutive newlines) down to 2 blank lines. */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{4,}/g, '\n\n\n');
}

function truncateOnLineBoundary(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const slice = text.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf('\n');
  // Only prefer the line boundary if it doesn't sacrifice a large chunk of
  // the character budget chasing one.
  const cut = lastNewline > maxChars / 2 ? lastNewline : maxChars;
  return { text: slice.slice(0, cut), truncated: true };
}

async function extractPdf(
  filePath: string,
  fileName: string
): Promise<{ text: string; pageCount: number | null; title: string | null }> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    throw new DocumentExtractionError('unreadable', `Could not read ${fileName}: ${errorMessage(error)}`);
  }

  try {
    const parsed = await pdfParse(buffer);
    const rawTitle = parsed.info?.Title;
    const title = typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle : null;
    const pageCount = typeof parsed.numpages === 'number' ? parsed.numpages : null;
    return { text: parsed.text ?? '', pageCount, title };
  } catch (error) {
    throw new DocumentExtractionError('parse-failed', `Failed to parse PDF ${fileName}: ${errorMessage(error)}`);
  }
}

async function extractDocx(filePath: string, fileName: string): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    if (result.messages.length > 0) {
      const details = result.messages.map((message) => `[${message.type}] ${message.message}`).join('\n');
      console.warn(
        `[document-extraction] mammoth reported ${result.messages.length} warning(s) while extracting ${fileName}:\n${details}`
      );
    }
    return result.value;
  } catch (error) {
    throw new DocumentExtractionError('parse-failed', `Failed to parse DOCX ${fileName}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

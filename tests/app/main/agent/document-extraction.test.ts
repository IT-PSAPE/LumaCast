// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  DocumentExtractionError,
  EXTRACTABLE_DOCUMENT_EXTENSIONS,
  detectDocumentKind,
  extractDocumentText,
} from '../../../../app/main/agent/document-extraction';

// The bundled pdf.js this version of `pdf-parse` ships (v1.10.100) rejected
// two independently hand-built, byte-verified, spec-compliant minimal PDFs
// (one with " \n"-terminated xref entries, one with "\r\n"-terminated
// entries) with "bad XRef entry" — see conversation notes. Per the task's
// fallback instructions, pdf-parse is mocked here instead so these tests
// cover this module's own wrapper logic (option/error handling, field
// mapping) rather than pdf.js's xref parser.
const mockPdfParse = vi.fn();

vi.mock('pdf-parse/lib/pdf-parse.js', () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
}));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-doc-extraction-'));
  mockPdfParse.mockReset();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeFile(name: string, content: string | Buffer): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Builds a minimal but real .docx (a zip with `[Content_Types].xml`,
 * `_rels/.rels`, and `word/document.xml`) via `jszip`, mammoth's own zip
 * dependency, already present in `node_modules`. `bodyXml` is spliced
 * directly into `<w:body>`.
 */
async function buildDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.folder('_rels')!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.folder('word')!.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('detectDocumentKind', () => {
  it('maps every registered extension (case-insensitively) to its kind', () => {
    for (const [extension, kind] of Object.entries(EXTRACTABLE_DOCUMENT_EXTENSIONS)) {
      expect(detectDocumentKind(`file${extension}`)).toBe(kind);
      expect(detectDocumentKind(`file${extension.toUpperCase()}`)).toBe(kind);
    }
  });

  it('returns null for an unregistered extension', () => {
    expect(detectDocumentKind('file.xyz')).toBeNull();
    expect(detectDocumentKind('file')).toBeNull();
  });
});

describe('extractDocumentText — text-like kinds', () => {
  it('reads a .txt file as kind "text"', async () => {
    const filePath = writeFile('notes.txt', 'Plain notes.');
    const result = await extractDocumentText(filePath);
    expect(result).toMatchObject({
      kind: 'text',
      text: 'Plain notes.',
      truncated: false,
      pageCount: null,
      title: null,
      fileName: 'notes.txt',
    });
    expect(result.charCount).toBe('Plain notes.'.length);
  });

  it('reads a .md file as kind "markdown"', async () => {
    const filePath = writeFile('outline.md', '# Title\n\nBody.');
    const result = await extractDocumentText(filePath);
    expect(result.kind).toBe('markdown');
    expect(result.text).toBe('# Title\n\nBody.');
  });

  it('reads a .csv file as kind "csv"', async () => {
    const filePath = writeFile('rows.csv', 'a,b,c\n1,2,3');
    const result = await extractDocumentText(filePath);
    expect(result.kind).toBe('csv');
    expect(result.text).toBe('a,b,c\n1,2,3');
  });

  it('strips a UTF-8 BOM and normalises CRLF to LF', async () => {
    const withBom = '﻿Line one\r\nLine two\r\n';
    const filePath = writeFile('crlf.txt', withBom);
    const result = await extractDocumentText(filePath);
    expect(result.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.text).toBe('Line one\nLine two\n');
  });

  it('pretty-prints valid JSON', async () => {
    const filePath = writeFile('data.json', '{"a":1,"b":[2,3]}');
    const result = await extractDocumentText(filePath);
    expect(result.kind).toBe('json');
    expect(result.text).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
  });

  it('falls back to raw content when JSON does not parse', async () => {
    const raw = '{not valid json,,,';
    const filePath = writeFile('bad.json', raw);
    const result = await extractDocumentText(filePath);
    expect(result.kind).toBe('json');
    expect(result.text).toBe(raw);
  });

  it('collapses runs of 3+ blank lines to 2, leaving smaller gaps untouched', async () => {
    const raw = 'Intro\n\nMiddle\n\n\n\n\nEnd';
    const filePath = writeFile('spacing.txt', raw);
    const result = await extractDocumentText(filePath);
    expect(result.text).toBe('Intro\n\nMiddle\n\n\nEnd');
  });

  it('truncates on a line boundary when one falls in the back half of the budget', async () => {
    const raw = `${'A'.repeat(30)}\n${'B'.repeat(5)}\n${'C'.repeat(30)}`;
    const filePath = writeFile('boundary.txt', raw);
    const result = await extractDocumentText(filePath, { maxChars: 40 });
    expect(result.truncated).toBe(true);
    expect(result.text).toBe(`${'A'.repeat(30)}\n${'B'.repeat(5)}`);
    expect(result.text.length).toBeLessThanOrEqual(40);
    expect(result.charCount).toBe(result.text.length);
  });

  it('hard-cuts at maxChars when no nearby line boundary exists', async () => {
    const raw = 'X'.repeat(200);
    const filePath = writeFile('nolines.txt', raw);
    const result = await extractDocumentText(filePath, { maxChars: 50 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(50);
    expect(result.text).toBe('X'.repeat(50));
  });

  it('does not truncate when text is exactly at the budget', async () => {
    const raw = 'Y'.repeat(50);
    const filePath = writeFile('exact.txt', raw);
    const result = await extractDocumentText(filePath, { maxChars: 50 });
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(raw);
  });
});

describe('extractDocumentText — failure cases', () => {
  it('rejects with "too-large" when the file exceeds maxFileBytes', async () => {
    const filePath = writeFile('big.txt', 'x'.repeat(200));
    await expect(extractDocumentText(filePath, { maxFileBytes: 100 })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('rejects with "unreadable" for a missing file', async () => {
    const filePath = path.join(dir, 'missing.txt');
    await expect(extractDocumentText(filePath)).rejects.toBeInstanceOf(DocumentExtractionError);
    await expect(extractDocumentText(filePath)).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('rejects with "unreadable" for a directory', async () => {
    const dirPath = path.join(dir, 'a-directory.txt');
    fs.mkdirSync(dirPath);
    await expect(extractDocumentText(dirPath)).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('rejects with "unsupported" for an unregistered extension', async () => {
    const filePath = writeFile('notes.xyz', 'whatever');
    await expect(extractDocumentText(filePath)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('extractDocumentText — pdf', () => {
  it('maps pdf-parse output to text, pageCount, and title', async () => {
    mockPdfParse.mockResolvedValueOnce({
      text: 'Hello LumaCast',
      numpages: 3,
      numrender: 3,
      info: { Title: 'My Deck' },
      metadata: null,
      version: 'v1.10.100',
    });
    const filePath = writeFile('deck.pdf', Buffer.from('%PDF-1.4 fake'));

    const result = await extractDocumentText(filePath);

    expect(result.kind).toBe('pdf');
    expect(result.text).toBe('Hello LumaCast');
    expect(result.pageCount).toBe(3);
    expect(result.title).toBe('My Deck');
    expect(mockPdfParse).toHaveBeenCalledTimes(1);
  });

  it('treats a missing or blank title as null', async () => {
    mockPdfParse.mockResolvedValueOnce({
      text: 'x',
      numpages: 1,
      numrender: 1,
      info: { Title: '   ' },
      metadata: null,
      version: null,
    });
    const filePath = writeFile('deck-no-title.pdf', Buffer.from('%PDF-1.4 fake'));

    const result = await extractDocumentText(filePath);

    expect(result.title).toBeNull();
  });

  it('wraps a pdf-parse failure as parse-failed', async () => {
    mockPdfParse.mockRejectedValueOnce(new Error('corrupt xref'));
    const filePath = writeFile('bad.pdf', Buffer.from('%PDF-1.4 fake'));

    await expect(extractDocumentText(filePath)).rejects.toMatchObject({
      code: 'parse-failed',
      message: expect.stringContaining('corrupt xref'),
    });
  });
});

describe('extractDocumentText — docx', () => {
  it('extracts raw text from a real minimal docx via mammoth', async () => {
    const buffer = await buildDocx('<w:p><w:r><w:t>Hello LumaCast</w:t></w:r></w:p>');
    const filePath = writeFile('brief.docx', buffer);

    const result = await extractDocumentText(filePath);

    expect(result.kind).toBe('docx');
    expect(result.text).toContain('Hello LumaCast');
    expect(result.pageCount).toBeNull();
    expect(result.title).toBeNull();
  });

  it('routes mammoth warnings to console.warn and keeps them out of the result', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const buffer = await buildDocx('<w:p><w:r><w:t>Hello LumaCast</w:t></w:r></w:p><w:bogusElement/>');
      const filePath = writeFile('brief-with-warning.docx', buffer);

      const result = await extractDocumentText(filePath);

      expect(result.text).toContain('Hello LumaCast');
      expect(result.text).not.toContain('unrecognised');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('unrecognised element');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('wraps a mammoth failure (invalid zip) as parse-failed', async () => {
    const filePath = writeFile('garbage.docx', Buffer.from('not a zip file at all'));

    await expect(extractDocumentText(filePath)).rejects.toMatchObject({ code: 'parse-failed' });
  });
});

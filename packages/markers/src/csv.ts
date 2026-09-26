// CSV is the primary interchange format between LumaCast and LumaChord:
// three columns, `order,timestamp,text`. Parsing follows RFC 4180 (quoted
// fields, `""` escapes, embedded newlines inside quotes) and is tolerant of a
// UTF-8 BOM, an optional header row, `\r\n`/`\n` line endings, extra columns,
// and rows whose timestamp does not parse.
import type { ParseResult, TimedCue } from './types';
import { formatTimestamp, parseTimestamp } from './timestamp';

const BOM = '﻿';
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function isNumeric(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && NUMERIC_RE.test(trimmed);
}

// A minimal RFC 4180 tokenizer: quoted fields may contain commas, newlines,
// and `""`-escaped quotes; unquoted fields end at the next comma or line
// break. `\r\n` and bare `\n` both end a record.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const flushField = () => {
    row.push(field);
    field = '';
  };
  const flushRow = () => {
    flushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      flushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      flushRow();
      i += 1;
      if (text[i] === '\n') i += 1;
      continue;
    }
    if (c === '\n') {
      flushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Only flush a trailing record if there is unflushed content — a trailing
  // line break must not manufacture a phantom empty row.
  if (field.length > 0 || row.length > 0) flushRow();
  return rows;
}

function quoteCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Parses CSV text into cues. Columns are positional: order, timestamp, text.
 * A header row is detected when the first row's second cell does not parse
 * as a timestamp and the first cell is not a number. Extra columns beyond
 * the three are ignored with a single warning; rows with an unparseable
 * timestamp are skipped with a warning naming the row number. When the order
 * column is present and numeric it breaks ties for a stable sort by
 * `startMs`; otherwise the row's file position is used. The result is always
 * sorted by `startMs` and renumbered 1..n.
 */
export function parseCsv(text: string): ParseResult {
  const stripped = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const rows = parseCsvRows(stripped);
  const warnings: string[] = [];
  if (rows.length === 0) return { cues: [], warnings };

  const first = rows[0];
  const firstCell = (first[0] ?? '').trim();
  const secondCell = first[1] ?? '';
  const looksLikeHeader = !isNumeric(firstCell) && parseTimestamp(secondCell) === null;

  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  const headerRows = looksLikeHeader ? 1 : 0;

  let warnedExtraColumns = false;
  const parsed: { sequenceKey: number; startMs: number; text: string }[] = [];

  dataRows.forEach((cols, idx) => {
    const fileRowNumber = headerRows + idx + 1;
    if (cols.length > 3 && !warnedExtraColumns) {
      warnings.push(
        `Row ${fileRowNumber}: extra columns beyond order, timestamp, text are ignored`,
      );
      warnedExtraColumns = true;
    }
    const orderCell = (cols[0] ?? '').trim();
    const timestampCell = cols[1] ?? '';
    const textCell = cols[2] ?? '';

    const startMs = parseTimestamp(timestampCell);
    if (startMs === null) {
      warnings.push(`Row ${fileRowNumber}: skipped (unparseable timestamp "${timestampCell}")`);
      return;
    }

    const sequenceKey = isNumeric(orderCell) ? Number(orderCell) : idx + 1;
    parsed.push({ sequenceKey, startMs, text: textCell });
  });

  const cues: TimedCue[] = parsed
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.sequenceKey - b.sequenceKey)
    .map((row, idx) => ({ order: idx + 1, startMs: row.startMs, endMs: null, text: row.text }));

  return { cues, warnings };
}

/**
 * Formats cues as CSV: header `order,timestamp,text`, `\n` line endings,
 * cues written in the given order and renumbered from 1. The text field is
 * always quoted (`""`-escaped) so commas and newlines survive.
 */
export function formatCsv(cues: readonly TimedCue[]): string {
  const lines = ['order,timestamp,text'];
  cues.forEach((cue, idx) => {
    lines.push(`${idx + 1},${formatTimestamp(cue.startMs)},${quoteCsvField(cue.text)}`);
  });
  return lines.join('\n');
}

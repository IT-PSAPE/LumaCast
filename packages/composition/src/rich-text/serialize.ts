// Serialization between a Rich Body and its plain-text projection.
// See docs/superpowers/specs/2026-06-02-rich-text-design.md §4.
//
// `richBodyToText` produces the newline-joined plain string used as the `text`
// fallback (and for search). `textToRichBody` is the inverse for plain content:
// each newline-delimited line becomes one Block with a single override-free Run.
// Blocks are the hard-break unit — Runs never contain a newline, so the two
// functions round-trip line structure exactly.

import type { RichBlock, RichBody } from './types';

export interface ListInfo {
  listType?: 'bullet' | 'number';
  indent?: number;
}

export function richBodyToText(body: RichBody): string {
  return body.map(blockToText).join('\n');
}

function blockToText(block: RichBlock): string {
  return block.runs.map((run) => run.text).join('');
}

export function textToRichBody(text: string, listInfo?: ListInfo): RichBody {
  const listType = listInfo?.listType;
  const indent = listInfo?.indent ?? 0;
  return text.split('\n').map((line): RichBlock => {
    const block: RichBlock = { runs: [{ text: line }], indent };
    // Only set listType when present so "no formatting" stays byte-identical to plain.
    if (listType) block.listType = listType;
    return block;
  });
}

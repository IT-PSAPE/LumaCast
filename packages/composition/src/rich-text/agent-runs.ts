// Builds a Rich Body from the agent-facing `element.setRichText` action's
// params (`packages/protocol/src/action-schemas.ts`'s `elementSetRichTextSchema`).
// That schema takes either a plain `text` string or a flat `runs` array —
// unlike the interactive editor, it has no block-break marker, so every run
// supplied this way lands in a single paragraph block. See
// docs/superpowers/specs/2026-06-02-rich-text-design.md §4 for the model.

import type { RichBody, RichRun } from './types';
import { textToRichBody } from './serialize';

/**
 * The agent-facing run shape for `element.setRichText`'s `runs` param.
 * Identical to `RichRun` — the schema's `richRunSchema` is declared
 * `satisfies Schema<RichRun>` — aliased here so the executor's intent reads
 * clearly at the call site.
 */
export type RichRunSpec = RichRun;

/**
 * Builds a single-block Rich Body from a flat run list. `element.setRichText`
 * carries no block-break marker in its `runs` param, so every run lands in
 * one paragraph block, in order.
 */
export function buildRichBodyFromRuns(runs: readonly RichRunSpec[]): RichBody {
  const blockRuns = runs.length > 0 ? runs.map((run) => ({ ...run })) : [{ text: '' }];
  return [{ runs: blockRuns, indent: 0 }];
}

/** Builds a Rich Body from plain text, splitting hard line breaks into blocks. */
export function richBodyFromPlainText(text: string): RichBody {
  return textToRichBody(text);
}

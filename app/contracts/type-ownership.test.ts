import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Structural/ownership guard for #154 (parent #116): IPC inputs/results and
// application-facing contracts (deck-bundle manifest) moved out of the broad
// `app/core/types.ts` facade into process-neutral modules under
// `app/contracts/`. This is a source-text/static-analysis test, not a
// behavioral one — same approach as `app/database/type-boundaries.test.ts`
// (#153) — and asserts three things per the #154 acceptance criteria:
//
//   1. Every moved family is DECLARED in its `app/contracts/` owner module
//      and only RE-EXPORTED (never re-declared) by `app/core/types.ts`.
//   2. No persistence row type (the `ProjectBackup*Row` family, or anything
//      shaped like one) appears in the IPC/application contract modules.
//   3. `app/core/types.ts`'s remaining non-facade declarations are exactly
//      the renderer view models (`PlaybackState`, `SlideBrowserMode`) that
//      #155, not this slice, is responsible for moving.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CORE_TYPES_FILE = path.resolve(REPO_ROOT, 'app/core/types.ts');
const CONTRACTS_DIR = path.resolve(REPO_ROOT, 'app/contracts');

const RPC_INPUTS_FILE = path.resolve(CONTRACTS_DIR, 'rpc-inputs.ts');
const RPC_RESULTS_FILE = path.resolve(CONTRACTS_DIR, 'rpc-results.ts');
const DECK_BUNDLE_MANIFEST_FILE = path.resolve(CONTRACTS_DIR, 'deck-bundle-manifest.ts');
const NDI_OBSERVABILITY_FILE = path.resolve(CONTRACTS_DIR, 'ndi-observability.ts');

const MOVED_FAMILY_FILES: Record<string, string> = {
  'app/contracts/rpc-inputs.ts': RPC_INPUTS_FILE,
  'app/contracts/rpc-results.ts': RPC_RESULTS_FILE,
  'app/contracts/deck-bundle-manifest.ts': DECK_BUNDLE_MANIFEST_FILE,
  'app/contracts/ndi-observability.ts': NDI_OBSERVABILITY_FILE,
};

// Group A: RPC mutation inputs (app/contracts/rpc-inputs.ts).
const RPC_INPUT_NAMES = [
  'SlideBackgroundUpdateInput',
  'CollectionCreateInput',
  'CollectionRenameInput',
  'CollectionDeleteInput',
  'CollectionReorderInput',
  'CollectionAssignmentInput',
  'CueCreateInput',
  'CueUpdateInput',
  'MacroCreateInput',
  'MacroUpdateInput',
  'TriggerBindingCreateInput',
  'SlideCreateInput',
  'TalkScriptBlockCreateInput',
  'TalkScriptBlockUpdateInput',
  'TalkScriptBlockOrderUpdateInput',
  'SlideNotesUpdateInput',
  'SlideOrderUpdateInput',
  'ElementCreateInput',
  'ElementUpdateInput',
  'OverlayCreateInput',
  'OverlayUpdateInput',
  'ThemeCreateInput',
  'ThemeUpdateInput',
  'StageCreateInput',
  'StageUpdateInput',
  'MediaAssetCreateInput',
  'DeckBundleExportOptions',
];

// Group B: RPC query/result shapes, including the dual-natured AppSnapshot
// (app/contracts/rpc-results.ts).
const RPC_RESULT_NAMES = [
  'AppSnapshot',
  'DeckBundleInspectionItem',
  'DeckBundleInspectionTheme',
  'DeckBundleInspectionOverlay',
  'DeckBundleInspectionStage',
  'DeckBundleInspectionPlaylist',
  'BrokenDeckBundleReference',
  'DeckBundleInspection',
  'DeckBundleBrokenReferenceAction',
  'DeckBundleBrokenReferenceDecision',
];

// Group C: the deck-bundle manifest file-format tree
// (app/contracts/deck-bundle-manifest.ts) — an application contract, never
// named in `RpcMethodSignatures` (app/core/ipc.ts).
const DECK_BUNDLE_MANIFEST_NAMES = [
  'DeckBundleManifest',
  'DeckBundleTheme',
  'DeckBundleSlide',
  'DeckBundleTalkScriptBlock',
  'DeckBundleItem',
  'DeckBundleMediaReference',
  'DeckBundleStage',
  'DeckBundleOverlay',
  'DeckBundlePlaylistEntry',
  'DeckBundlePlaylistGroup',
  'DeckBundlePlaylist',
];

// NDI output/diagnostics and observability surface
// (app/contracts/ndi-observability.ts).
const NDI_OBSERVABILITY_NAMES = [
  'NdiOutputName',
  'NdiOutputState',
  'NdiSourceStatus',
  'NdiOutputConfig',
  'NdiOutputConfigMap',
  'NdiTallyState',
  'NdiActiveSenderDiagnostics',
  'NdiFrameTelemetry',
  'NdiPipelineStageStats',
  'NdiPipelineLatencyDiagnostics',
  'NdiSenderPerformanceDiagnostics',
  'NdiSenderAudioDiagnostics',
  'NdiDiagnostics',
  'SystemProcessMetrics',
  'SystemMetricsSnapshot',
  'LogSessionSummary',
  'LogReadResult',
];

// Every name #154 moved out of app/core/types.ts, mapped to the module that
// now declares it.
const MOVED_NAME_TO_FILE: Record<string, string> = {};
for (const name of RPC_INPUT_NAMES) MOVED_NAME_TO_FILE[name] = 'app/contracts/rpc-inputs.ts';
for (const name of RPC_RESULT_NAMES) MOVED_NAME_TO_FILE[name] = 'app/contracts/rpc-results.ts';
for (const name of DECK_BUNDLE_MANIFEST_NAMES) MOVED_NAME_TO_FILE[name] = 'app/contracts/deck-bundle-manifest.ts';
for (const name of NDI_OBSERVABILITY_NAMES) MOVED_NAME_TO_FILE[name] = 'app/contracts/ndi-observability.ts';

// Names #154 deliberately leaves declared directly in app/core/types.ts:
// renderer view models that are #155's job, not this slice's.
const RETAINED_RENDERER_VIEW_MODEL_NAMES = ['PlaybackState', 'SlideBrowserMode'];

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/** Matches a real type/interface declaration: `export interface Name` or `export type Name =` / `export type Name<...`. */
function declarationRegex(name: string): RegExp {
  return new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b(?:\\s*<[^=]*>)?\\s*(=|\\{|extends)`);
}

/** Matches the name appearing inside an `export type { ... } from '...'` re-export block (possibly multi-line). */
function reExportRegex(name: string): RegExp {
  // Re-export blocks in these files are `export type { A, B, ... } from '...';`,
  // across one or more lines. Match the bare identifier bounded by
  // punctuation/whitespace typical of a named-export list, then require a
  // `from` clause somewhere after it before the statement terminates.
  return new RegExp(`export type \\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"]`, 's');
}

describe('IPC/application contract ownership (#154)', () => {
  it('every moved family module exists and is non-empty', () => {
    for (const [label, file] of Object.entries(MOVED_FAMILY_FILES)) {
      expect(fs.existsSync(file), `${label} should exist`).toBe(true);
      expect(readSource(file).trim().length, `${label} should not be empty`).toBeGreaterThan(0);
    }
  });

  describe.each(Object.entries(MOVED_NAME_TO_FILE))('%s', (name, ownerLabel) => {
    it(`is declared in its owning contract module (${ownerLabel})`, () => {
      const ownerFile = MOVED_FAMILY_FILES[ownerLabel];
      const source = readSource(ownerFile);
      expect(
        declarationRegex(name).test(source),
        `expected ${ownerLabel} to declare ${name} directly`,
      ).toBe(true);
    });

    it('is only re-exported (never re-declared) by app/core/types.ts', () => {
      const source = readSource(CORE_TYPES_FILE);
      expect(
        declarationRegex(name).test(source),
        `app/core/types.ts must not declare ${name} directly — it should only re-export it`,
      ).toBe(false);
      expect(
        reExportRegex(name).test(source),
        `app/core/types.ts should re-export ${name} via an 'export type { ... } from ...' statement`,
      ).toBe(true);
    });
  });

  it('app/core/types.ts declares no interface/type other than the retained renderer view models', () => {
    const source = readSource(CORE_TYPES_FILE);
    // Strip every `export type { ... } from '...'` re-export block (which
    // legitimately contains the moved names as plain text) before scanning
    // for real declarations, so this check only sees actual `interface`/`type`
    // definitions.
    const withoutReExports = source.replace(/export type \{[^}]*\}\s*from\s*['"][^'"]+['"];?/gs, '');
    const declared = new Set<string>();
    const declRe = /export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/g;
    let match: RegExpExecArray | null;
    while ((match = declRe.exec(withoutReExports))) {
      declared.add(match[1]);
    }
    expect(Array.from(declared).sort()).toEqual([...RETAINED_RENDERER_VIEW_MODEL_NAMES].sort());
  });

  it('no moved family name is declared twice (once in its owner module, and accidentally again elsewhere in app/contracts/)', () => {
    const allNames = Object.keys(MOVED_NAME_TO_FILE);
    for (const [label, file] of Object.entries(MOVED_FAMILY_FILES)) {
      const source = readSource(file);
      for (const name of allNames) {
        const ownedHere = MOVED_NAME_TO_FILE[name] === label;
        const declaredHere = declarationRegex(name).test(source);
        if (!ownedHere) {
          expect(declaredHere, `${label} must not also declare ${name} (owned by ${MOVED_NAME_TO_FILE[name]})`).toBe(false);
        }
      }
    }
  });

  it('no persistence row type (the ProjectBackup*Row family, or a name ending in "Row") appears anywhere in the moved IPC/application contract modules', () => {
    const rowLikePattern = /\bProjectBackup\w*Row\b|\b[A-Za-z]+Row\b/;
    for (const [label, file] of Object.entries(MOVED_FAMILY_FILES)) {
      const source = readSource(file);
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        expect(
          rowLikePattern.test(line),
          `${label}:${index + 1} should not reference a persistence row type: ${line.trim()}`,
        ).toBe(false);
      });
    }
  });

  it('no moved contract module imports app/database, app/main, React, or Electron (contracts-purity, issue #149/#216)', () => {
    const forbidden = [
      /from\s+['"]electron['"]/,
      /from\s+['"]react['"]/,
      /from\s+['"]@database\//,
      /from\s+['"]\.\.\/database\//,
      /from\s+['"]@main\//,
      /from\s+['"]\.\.\/main\//,
      /from\s+['"]\.\.\/renderer\//,
      /from\s+['"]@renderer\//,
    ];
    for (const [label, file] of Object.entries(MOVED_FAMILY_FILES)) {
      const source = readSource(file);
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${label} must not match forbidden import pattern ${pattern}`).toBe(false);
      }
    }
  });

  it('the deck-bundle manifest module is never named in app/core/ipc.ts\'s RpcMethodSignatures (it is a file-format contract, not a wire-payload contract)', () => {
    const ipcFile = path.resolve(REPO_ROOT, 'app/core/ipc.ts');
    const source = readSource(ipcFile);
    const signaturesMatch = /interface RpcMethodSignatures \{([\s\S]*?)\n\}/.exec(source);
    expect(signaturesMatch, 'expected to find RpcMethodSignatures in app/core/ipc.ts').not.toBeNull();
    const signaturesBody = signaturesMatch![1];
    for (const name of DECK_BUNDLE_MANIFEST_NAMES) {
      expect(
        signaturesBody.includes(name),
        `${name} (deck-bundle manifest family) should not appear in RpcMethodSignatures`,
      ).toBe(false);
    }
  });
});

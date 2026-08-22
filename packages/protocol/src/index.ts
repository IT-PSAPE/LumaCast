// Public entry point for @lumacast/protocol (issue #219, wave W4). This
// package is the wire-level contract layer: the canonical IPC surface
// (`ipc.ts`), the renderer's diffed-update representation (`snapshot-patch.ts`),
// the on-disk deck-bundle manifest format and its import/export helpers
// (`deck-bundle-manifest.ts`, `deck-bundles.ts`), NDI output/diagnostics and
// observability shapes (`ndi-observability.ts`, `ndi.ts`), the full-project
// backup envelope (`project-backup.ts`), the RPC argument/result shapes
// (`rpc-inputs.ts`, `rpc-results.ts`), and the runtime codecs that decode all
// of the above at trust boundaries (`codecs.ts`).
//
// This is the highest-blast-radius wave of the package split: it retires
// `app/core/types.ts`, the temporary compatibility facade every other zone
// imported domain/automation/contract types through. Every former importer
// of `@core/types` now imports directly from its real owner —
// `@lumacast/composition`, `@lumacast/automation`, `@lumacast/kernel`, or
// this package.
export * from './codecs';
export * from './deck-bundle-manifest';
export * from './deck-bundles';
export * from './ndi';
export * from './ndi-frame-transport';
export * from './ndi-observability';
export * from './project-backup';
export * from './rpc-inputs';
export * from './rpc-results';
export * from './ipc';
export * from './snapshot-patch';

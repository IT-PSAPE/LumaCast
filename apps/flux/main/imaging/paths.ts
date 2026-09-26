import path from 'node:path';

// The app's non-bundled runtime resources, resolved as data rather than
// constants so the layout is testable without a built app. Every path is
// derived from the directory the main bundle itself lives in (`out/main`):
//
//   <out>/main/index.js
//   <out>/main/imaging/render-worker.js   worker thread started by RenderPool
//   <out>/main/imaging/raw-decoder.mjs    disposable RAW decode worker
//   <out>/mcp/stdio.mjs                    standalone stdio MCP bridge
//
// A packaged build copies the stdio bridge to `resources/mcp/stdio.mjs`
// instead, because an external MCP client spawns it with `node` from outside
// the app bundle; see main/index.ts.
export interface ImagingResources {
  renderWorkerEntry: string;
  rawDecoderEntry: string;
  mcpStdioEntry: string;
}

export function resolveImagingResources(mainBundleDir: string): ImagingResources {
  return {
    renderWorkerEntry: path.join(mainBundleDir, 'imaging', 'render-worker.js'),
    rawDecoderEntry: path.join(mainBundleDir, 'imaging', 'raw-decoder.mjs'),
    mcpStdioEntry: path.join(mainBundleDir, '..', 'mcp', 'stdio.mjs'),
  };
}

export interface WorkerResources {
  /** The disposable RAW decode worker, which sits beside the render worker. */
  rawDecoderEntry: string;
}

/**
 * The render worker resolves its own resources from *its own* bundle directory
 * (`out/main/imaging`), not from the main bundle's (`out/main`), so it must not
 * go through `resolveImagingResources`: that would look for the worker one
 * directory too deep (`out/main/imaging/imaging/render-worker.js`) and fail
 * every RAW decode in a packaged build.
 */
export function resolveWorkerResources(workerBundleDir: string): WorkerResources {
  return {
    rawDecoderEntry: path.join(workerBundleDir, 'raw-decoder.mjs'),
  };
}

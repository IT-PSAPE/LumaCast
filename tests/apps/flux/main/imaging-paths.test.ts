import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveImagingResources,
  resolveWorkerResources,
} from '../../../../apps/flux/main/imaging/paths';

const APP_DIR = path.resolve(__dirname, '../../../../apps/flux');

/**
 * Returns the source of the object literal that starts at the first `{` at or
 * after `start`, i.e. the whole `viteBuild({...})` argument block. Quotes and
 * line comments are skipped so a brace inside prose or a string cannot end the
 * block early.
 */
function balancedCallBlock(source: string, start: number): string {
  const open = source.indexOf('{', start);
  let depth = 0;

  for (let i = open; i < source.length; i += 1) {
    const char = source[i];

    if (char === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      i += 1;
      while (i < source.length && source[i] !== char) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }

  return source.slice(open);
}

describe('apps/flux imaging worker resources', () => {
  const outMain = path.join(APP_DIR, 'out', 'main');
  const resources = resolveImagingResources(outMain);

  it('resolves every worker entry beside the main bundle, not from a repository path', () => {
    expect(resources.renderWorkerEntry).toBe(path.join(outMain, 'imaging', 'render-worker.js'));
    expect(resources.rawDecoderEntry).toBe(path.join(outMain, 'imaging', 'raw-decoder.mjs'));
    expect(resources.mcpStdioEntry).toBe(path.join(outMain, '..', 'mcp', 'stdio.mjs'));

    for (const resolved of Object.values(resources)) {
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved.startsWith(path.join(APP_DIR, 'out'))).toBe(true);
    }
  });

  it('resolves the RAW decoder from the render worker bundle dir, not the main bundle dir', () => {
    // The render worker bundle lives at out/main/imaging, so its own __dirname
    // is one level below the main bundle's. Reusing the main-bundle resolver
    // there would look for out/main/imaging/imaging/render-worker.js and break
    // every RAW decode in a packaged build.
    const workerBundleDir = path.join(outMain, 'imaging');
    const workerResources = resolveWorkerResources(workerBundleDir);

    expect(workerResources.rawDecoderEntry).toBe(path.join(workerBundleDir, 'raw-decoder.mjs'));
    expect(workerResources.rawDecoderEntry).toBe(resources.rawDecoderEntry);
    expect(workerResources.rawDecoderEntry).not.toContain(
      path.join('imaging', 'imaging'),
    );
  });

  it('configures the RAW decoder in every process that can decode a photo, from its own bundle dir', () => {
    // Main does not decode itself, but it spawns render workers; the worker
    // decodes. Both must point the package at the same decoder file, so a
    // packaged build finds it inside its own bundle — and each resolves it from
    // its *own* bundle directory.
    expect(readFileSync(path.join(APP_DIR, 'main/index.ts'), 'utf8')).toContain(
      'resolveImagingResources(__dirname)',
    );

    const worker = readFileSync(path.join(APP_DIR, 'main/imaging/render-worker.ts'), 'utf8');
    expect(worker).toContain('configureRawDecoder(');
    expect(worker).toContain('resolveWorkerResources(__dirname)');
    expect(worker).not.toContain('resolveImagingResources(');
  });

  it('emits the built artefacts with the extensions Node and new Worker() require', () => {
    expect(path.extname(resources.renderWorkerEntry)).toBe('.js');
    expect(path.extname(resources.rawDecoderEntry)).toBe('.mjs');
    expect(path.extname(resources.mcpStdioEntry)).toBe('.mjs');
  });

  it('keeps the native worker dependencies external instead of bundled', () => {
    const config = readFileSync(path.join(APP_DIR, 'electron.vite.config.ts'), 'utf8');
    const workerBlock = config.slice(0, config.indexOf('main/mcp/stdio.ts'));

    // sharp/libvips and the LibRaw WASM decoder are real files shipped in
    // node_modules, so the worker must require them at runtime.
    expect(workerBlock).toContain("'sharp'");
    expect(workerBlock).toContain('libraw-wasm');
  });

  it('keeps the RAW decoder importable next to the worker (no deep package import)', () => {
    const decoder = readFileSync(path.join(APP_DIR, 'main/imaging/raw-decoder.mjs'), 'utf8');

    // The decoder is a standalone worker, so it reaches the WASM module through
    // the installed package and never through the imaging package's own source.
    expect(decoder).toMatch(/from ['"]libraw-wasm\/dist\/libraw\.js['"]/);
    expect(decoder).not.toContain('@lumacast/photo-imaging');
  });

  it('copies the RAW decoder verbatim at build time instead of bundling it', () => {
    const config = readFileSync(path.join(APP_DIR, 'electron.vite.config.ts'), 'utf8');

    // libraw-wasm resolves its own .wasm next to the module, so the decoder has
    // to keep its real file location; it is copied, never bundled.
    expect(config).toContain("copyFile(");
    expect(config).toContain("out/main/imaging/raw-decoder.mjs");
  });

  it('builds the render worker and the stdio bridge as their own bundles', () => {
    const config = readFileSync(path.join(APP_DIR, 'electron.vite.config.ts'), 'utf8');

    expect(config).toContain("main/imaging/render-worker.ts");
    expect(config).toContain("'imaging/render-worker.js'");
    expect(config).toContain("main/mcp/stdio.ts");
    expect(config).toContain("'stdio.mjs'");
  });

  it('keeps the stdio bundle free of workspace source paths, because it is shipped alone', () => {
    const config = readFileSync(path.join(APP_DIR, 'electron.vite.config.ts'), 'utf8');
    const entry = config.indexOf('main/mcp/stdio.ts');

    // The assertions below straddle the lib entry — `noExternal` sits above it
    // and `rollupOptions.external` below it — so the block has to be the whole
    // viteBuild call. Truncating at the entry would drop the external check.
    const start = config.lastIndexOf('await viteBuild({', entry);
    expect(start).toBeGreaterThan(-1);
    const stdioBlock = balancedCallBlock(config, start);

    // Everything but Node builtins is bundled in: a packaged app copies only
    // this one file into resources/, where a bare specifier cannot resolve.
    expect(stdioBlock).toContain('noExternal: true');
    expect(stdioBlock).toContain('ssr: true');
    expect(stdioBlock).toContain('external: [/^node:/]');
  });

  it('keeps the decoder source in the app tree, not only in build output', () => {
    expect(existsSync(path.join(APP_DIR, 'main/imaging/raw-decoder.mjs'))).toBe(true);
  });

  it('keeps the app decoder byte-identical to the package decoder', () => {
    // The decoder is copied at build time, so the two files are two copies of
    // one source of truth. A silent divergence would mean a packaged build
    // decodes RAW differently from the package's own source tests, which is the
    // only thing that makes those tests meaningful.
    const appDecoder = readFileSync(
      path.join(APP_DIR, 'main/imaging/raw-decoder.mjs'),
    );
    const packageDecoder = readFileSync(
      path.resolve(APP_DIR, '../../packages/photo-imaging/src/raw-decoder.mjs'),
    );

    expect(appDecoder.equals(packageDecoder)).toBe(true);
  });
});

// @vitest-environment node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as PatchTool from '../../tool/patch-mediabunny.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE = path.join(ROOT, 'node_modules/mediabunny');
const PATCH = path.join(ROOT, 'tool/patches/mediabunny-1.60.0');
const definition = JSON.parse(fs.readFileSync(path.join(PATCH, 'patch.json'), 'utf8'));
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function originalFile(item: typeof definition.files[number]): Buffer {
  const bytes = fs.readFileSync(path.join(PACKAGE, item.path));
  if (digest(bytes) === item.originalSha256) return bytes;
  expect(digest(bytes)).toBe(item.patchedSha256);
  const lines = bytes.toString('utf8').split('\n');
  let shift = 0;
  const edits = item.edits.map((edit: { atLine: number; remove: string[]; insert: string[] }) => {
    const atLine = edit.atLine + shift;
    shift += edit.insert.length - edit.remove.length;
    return { ...edit, atLine };
  });
  for (const edit of edits.reverse()) {
    expect(lines.slice(edit.atLine, edit.atLine + edit.insert.length)).toEqual(edit.insert);
    lines.splice(edit.atLine, edit.insert.length, ...edit.remove);
  }
  const result = Buffer.from(lines.join('\n'));
  expect(digest(result)).toBe(item.originalSha256);
  return result;
}

async function fixture(fullPackage = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lumachord mediabunny patch-')));
  directories.push(root);
  const packageDir = path.join(root, 'node_modules/mediabunny');
  fs.mkdirSync(path.join(root, 'apps/chord/renderer'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/chord/package.json'), JSON.stringify({ dependencies: { mediabunny: '1.60.0' } }));
  fs.writeFileSync(path.join(root, 'apps/chord/renderer/index.html'), '<div></div>');
  fs.mkdirSync(path.join(root, 'tool'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tool/patch-mediabunny.mjs'), path.join(root, 'tool/patch-mediabunny.mjs'));
  fs.cpSync(PATCH, path.join(root, 'tool/patches/mediabunny-1.60.0'), { recursive: true });
  if (fullPackage) fs.cpSync(PACKAGE, packageDir, { recursive: true });
  const put = (relative: string, bytes: Uint8Array | string) => {
    const target = path.join(packageDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  };
  put('package.json', fs.readFileSync(path.join(PACKAGE, 'package.json')));
  for (const item of definition.files) put(item.path, originalFile(item));
  for (const item of definition.unchangedFiles) put(item.path, fs.readFileSync(path.join(PACKAGE, item.path)));
  // The require entry is only package discovery; it is never executed/patched.
  if (!fullPackage) put('dist/bundles/mediabunny.node.cjs', 'module.exports = {};');
  const tool = await import(pathToFileURL(path.join(root, 'tool/patch-mediabunny.mjs')).href) as typeof PatchTool;
  const snapshot = () => Object.fromEntries(definition.files.map((item: { path: string }) => [item.path, digest(fs.readFileSync(path.join(packageDir, item.path)))]));
  return { root, packageDir, tool, snapshot, definitionPath: path.join(root, 'tool/patches/mediabunny-1.60.0/patch.json') };
}

describe('reproducible MediaBunny lifecycle patch', () => {
  it('applies all source/runtime/types files coherently and reruns without writes', async () => {
    const f = await fixture();
    expect(() => f.tool.verifyMediaBunnyPatch({ rootDir: f.root })).toThrow('patch is missing');
    const result = f.tool.applyMediaBunnyPatch({ rootDir: f.root });
    expect(result.esmEntry).toBe(path.join(f.packageDir, definition.package.esmEntry));
    expect(result.patchedFiles).toHaveLength(13);
    expect(f.snapshot()).toEqual(Object.fromEntries(definition.files.map((item: { path: string; patchedSha256: string }) => [item.path, item.patchedSha256])));
    const write = vi.spyOn(fs, 'writeFileSync');
    const rename = vi.spyOn(fs, 'renameSync');
    expect(f.tool.applyMediaBunnyPatch({ rootDir: f.root })).toEqual(result);
    expect(f.tool.verifyMediaBunnyPatch({ rootDir: f.root })).toEqual(result);
    expect(write).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('refuses unexpected input without changing any other target', async () => {
    const f = await fixture();
    const item = definition.files.at(-1);
    fs.appendFileSync(path.join(f.packageDir, item.path), '\n// unexpected edit');
    const before = f.snapshot();
    expect(() => f.tool.applyMediaBunnyPatch({ rootDir: f.root })).toThrow('Unexpected MediaBunny contents');
    expect(f.snapshot()).toEqual(before);
  });

  it('safely resumes known original/final files while verify requires the whole final cohort', async () => {
    const f = await fixture();
    const item = definition.files.at(-1);
    const lines = originalFile(item).toString('utf8').split('\n');
    for (const edit of [...item.edits].reverse()) lines.splice(edit.atLine, edit.remove.length, ...edit.insert);
    fs.writeFileSync(path.join(f.packageDir, item.path), lines.join('\n'));
    expect(() => f.tool.verifyMediaBunnyPatch({ rootDir: f.root })).toThrow('complete patched cohort');
    const alreadyFinal = fs.statSync(path.join(f.packageDir, item.path), { bigint: true }).mtimeNs;
    f.tool.applyMediaBunnyPatch({ rootDir: f.root });
    expect(fs.statSync(path.join(f.packageDir, item.path), { bigint: true }).mtimeNs).toBe(alreadyFinal);
    expect(() => f.tool.verifyMediaBunnyPatch({ rootDir: f.root })).not.toThrow();
  });

  it('checks the final checksum of every result before any target or staging write', async () => {
    const f = await fixture();
    const data = JSON.parse(fs.readFileSync(f.definitionPath, 'utf8'));
    data.files.at(-1).patchedSha256 = '0'.repeat(64);
    fs.writeFileSync(f.definitionPath, JSON.stringify(data));
    const before = f.snapshot();
    const write = vi.spyOn(fs, 'writeFileSync');
    expect(() => f.tool.applyMediaBunnyPatch({ rootDir: f.root })).toThrow('result checksum mismatch');
    expect(write).not.toHaveBeenCalled();
    expect(f.snapshot()).toEqual(before);
  });

  it('fails closed on changed exports, source symlinks, notice bytes and inexact pins', async () => {
    for (const variant of ['exports', 'symlink', 'notice', 'pin']) {
      const f = await fixture();
      if (variant === 'exports') {
        const file = path.join(f.packageDir, 'package.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.exports['.'].browser.import = './dist/bundles/mediabunny.mjs';
        fs.writeFileSync(file, JSON.stringify(data));
      } else if (variant === 'symlink') {
        const file = path.join(f.packageDir, definition.files[0].path);
        const outside = path.join(f.root, 'owned-source-sentinel');
        fs.renameSync(file, outside);
        fs.symlinkSync(outside, file);
      } else if (variant === 'notice') {
        fs.appendFileSync(path.join(f.root, 'tool/patches/mediabunny-1.60.0/NOTICE.md'), 'changed');
      } else fs.writeFileSync(path.join(f.root, 'apps/chord/package.json'), JSON.stringify({ dependencies: { mediabunny: '^1.60.0' } }));
      const before = f.snapshot();
      expect(() => f.tool.applyMediaBunnyPatch({ rootDir: f.root }), variant).toThrow();
      expect(f.snapshot()).toEqual(before);
    }
  });

  it('refuses a mixed state after an interrupted filesystem replacement', async () => {
    const f = await fixture();
    const original = fs.renameSync;
    let calls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (++calls === 2) throw new Error('synthetic replacement failure');
      return original(from, to);
    });
    expect(() => f.tool.applyMediaBunnyPatch({ rootDir: f.root })).toThrow('patch did not finish');
    vi.restoreAllMocks();
    expect(() => f.tool.verifyMediaBunnyPatch({ rootDir: f.root })).toThrow('complete patched cohort');
    f.tool.applyMediaBunnyPatch({ rootDir: f.root });
    expect(() => f.tool.verifyMediaBunnyPatch({ rootDir: f.root })).not.toThrow();
    expect(fs.readdirSync(path.dirname(path.join(f.packageDir, definition.files[0].path))).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects unpatched configuration, CJS/nested core paths and stale prebundle options', async () => {
    const f = await fixture();
    expect(() => f.tool.mediaBunnyPatchPlugin({ rootDir: f.root })).toThrow('patch is missing');
    f.tool.applyMediaBunnyPatch({ rootDir: f.root });
    const plugin = f.tool.mediaBunnyPatchPlugin({ rootDir: f.root });
    const transform = plugin.transform as (source: string, id: string) => void;
    expect(() => transform('', path.join(f.packageDir, 'dist/bundles/mediabunny.node.cjs'))).toThrow('requires patched modular');
    const nested = path.join(f.root, 'other/node_modules/mediabunny/dist/modules/src/index.js');
    fs.mkdirSync(path.dirname(nested), { recursive: true }); fs.writeFileSync(nested, '');
    expect(() => transform('', nested)).toThrow('requires patched modular');
    const resolved = plugin.configResolved as (config: unknown) => void;
    expect(() => resolved({ optimizeDeps: { exclude: [], include: [] } })).toThrow('exclude the MediaBunny cohort');
    expect(() => resolved({ optimizeDeps: { exclude: ['mediabunny', '@mediabunny/aac-encoder', '@mediabunny/mp3-encoder'], include: ['@mediabunny/aac-encoder'] } })).toThrow('exclude the MediaBunny cohort');
    const start = plugin.buildStart as () => Promise<void>;
    for (const suffix of ['?raw', '?commonjs-proxy', '?v=12345678&raw', '?v=not-a-version']) {
      await expect(start.call({ resolve: async (name: string) => ({ id: name === 'mediabunny' ? path.join(f.packageDir, definition.package.esmEntry) + suffix : '/synthetic-codec.js' }) })).rejects.toThrow('Unexpected MediaBunny ESM resolution');
    }
  });

  it('accepts CRLF repository metadata with a stable fingerprint and rejects CRLF package bytes', async () => {
    const f = await fixture();
    const reference = await fixture();
    const expected = reference.tool.applyMediaBunnyPatch({ rootDir: reference.root }).fingerprint;
    for (const name of ['patch.json', 'LICENSE', 'NOTICE.md', 'upstream.diff']) {
      const file = path.join(f.root, 'tool/patches/mediabunny-1.60.0', name);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    }
    expect(f.tool.applyMediaBunnyPatch({ rootDir: f.root }).fingerprint).toBe(expected);
    const invalid = await fixture();
    const file = path.join(invalid.packageDir, definition.files[0].path);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    const before = invalid.snapshot();
    expect(() => invalid.tool.applyMediaBunnyPatch({ rootDir: invalid.root })).toThrow('Unexpected MediaBunny contents');
    expect(invalid.snapshot()).toEqual(before);
  });

  it('builds core and both codec extensions from verified ESM and emits exact source/license assets', async () => {
    const f = await fixture(true);
    for (const name of ['patch.json', 'LICENSE', 'NOTICE.md', 'upstream.diff']) {
      const file = path.join(f.root, 'tool/patches/mediabunny-1.60.0', name);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    }
    f.tool.applyMediaBunnyPatch({ rootDir: f.root });
    for (const name of ['aac-encoder', 'mp3-encoder']) {
      const destination = path.join(f.root, 'node_modules/@mediabunny', name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.symlinkSync(path.join(ROOT, 'node_modules/@mediabunny', name), destination, 'junction');
    }
    const entry = path.join(f.root, 'entry.js');
    fs.writeFileSync(entry, 'export { Output } from "mediabunny"; export * from "@mediabunny/aac-encoder"; export * from "@mediabunny/mp3-encoder";');
    const { build, createServer } = await import('vite');
    const seen: string[] = [];
    const output = await build({ configFile: false, root: f.root, envDir: f.root, cacheDir: path.join(f.root, 'cache'), logLevel: 'silent',
      plugins: [f.tool.mediaBunnyPatchPlugin({ rootDir: f.root }), { name: 'observe-core-paths', moduleParsed(info) { if (info.id.includes('/node_modules/mediabunny/')) seen.push(info.id); } }],
      build: { write: false, minify: false, reportCompressedSize: false, lib: { entry, formats: ['es'] }, outDir: path.join(f.root, 'out') },
    });
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.every((id) => id.startsWith(path.join(f.packageDir, 'dist/modules/')))).toBe(true);
    const chunks = Array.isArray(output) ? output.flatMap((item) => item.output) : 'output' in output ? output.output : [];
    const assets = chunks.filter((item) => item.type === 'asset' && item.fileName.startsWith('licenses/mediabunny/'));
    expect(assets).toHaveLength(9);
    for (const asset of assets) {
      if (asset.type !== 'asset') continue;
      const relative = asset.fileName.slice('licenses/mediabunny/'.length);
      const expected = fs.readFileSync(path.join(relative.startsWith('src/') ? f.packageDir : PATCH, relative));
      expect(digest(typeof asset.source === 'string' ? Buffer.from(asset.source) : asset.source)).toBe(digest(expected));
    }
    expect(fs.existsSync(path.join(f.root, 'out'))).toBe(false);
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const server = await createServer({ configFile: false, root: f.root, envDir: f.root, cacheDir: path.join(f.root, 'dev-cache'), logLevel: 'silent',
      plugins: [f.tool.mediaBunnyPatchPlugin({ rootDir: f.root })], server: { host: '127.0.0.1', port, strictPort: true },
    });
    try {
      await server.listen(); // Runs the real dev resolver, including its ?v tag.
      expect(server.httpServer?.listening).toBe(true);
      expect(server.config.optimizeDeps.exclude).toEqual(expect.arrayContaining(['mediabunny', '@mediabunny/aac-encoder', '@mediabunny/mp3-encoder']));
    } finally { await server.close(); }
  }, 15_000);

  it('settles actual ESM close/error/cancel paths and preserves bounded EOF content', async () => {
    const f = await fixture(true);
    f.tool.applyMediaBunnyPatch({ rootDir: f.root });
    for (const scenario of ['encoder-cleanup', 'finalize-order', 'cancel-order', 'undefined-primary', 'cancel-first',
      'cancel-during-close', 'mkv-write-failure', 'mp4-write-failure', 'bounded-eof', 'unchanged-content']) {
      const run = spawnSync(process.execPath, ['--max-old-space-size=192', path.join(ROOT, 'tests/tool/fixtures/mediabunny-lifecycle.mjs'), scenario, f.packageDir], {
        cwd: f.root, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
      });
      expect(run.error, scenario).toBeUndefined();
      expect(run.status, `${scenario}: ${run.stderr}\n${run.stdout}`).toBe(0);
      const result = JSON.parse(run.stdout.trim());
      expect(result.mode).toBe(scenario);
      expect(result.unhandled).toEqual([]);
    }
  }, 20_000);

  it.each(['build', 'serve'] as const)('loads the real electron-vite %s config with the imported patch guard', async (command) => {
    const { loadConfigFromFile } = await import('electron-vite');
    const app = path.join(ROOT, 'apps/chord');
    const loaded = await loadConfigFromFile({ command, mode: 'test' }, path.join(app, 'electron.vite.config.ts'), app, 'silent');
    expect(loaded).not.toBeNull();
    expect(loaded?.config.renderer?.plugins?.flat().some((plugin) => plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === 'lumachord-verified-mediabunny')).toBe(true);
    expect(loaded?.dependencies.map((dependency) => path.resolve(dependency))).toContain(path.join(ROOT, 'tool/patch-mediabunny.mjs'));
  });

  it('joins Conversion cleanup and preserves setup/pump errors without admitting canceled work', async () => {
    const f = await fixture(true);
    f.tool.applyMediaBunnyPatch({ rootDir: f.root });
    const run = spawnSync(process.execPath, ['--max-old-space-size=128', path.join(ROOT, 'tests/tool/fixtures/mediabunny-conversion-lifecycle.mjs'), f.packageDir], {
      cwd: f.root, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
    });
    expect(run.error).toBeUndefined();
    expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0);
    const result = JSON.parse(run.stdout.trim());
    expect(result.cases).toHaveLength(8);
    expect(result.unhandled).toEqual([]);
  });
});

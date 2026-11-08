// A deliberately single-package patch, not a general dependency patch runner.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATCH_DIR = fileURLToPath(new URL('./patches/mediabunny-1.60.0/', import.meta.url));
const CORE = ['media-source', 'output', 'matroska/matroska-muxer', 'isobmff/isobmff-muxer', 'conversion'];
const SOURCES = CORE.map((name) => `src/${name}.ts`);
const FILES = [...SOURCES, ...CORE.map((name) => `dist/modules/src/${name}.js`), 'dist/modules/src/media-source.d.ts', 'dist/modules/src/conversion.d.ts', 'dist/mediabunny.d.ts'].sort();
const COHORT = ['mediabunny', '@mediabunny/aac-encoder', '@mediabunny/mp3-encoder'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const recovery = 'Run npm ci to restore unexpected contents, then allow postinstall to apply the patch.';
// Git checkouts may use CRLF. Only repository text is canonicalized; package
// input/output bytes must always match their exact published/patched hashes.
const artifactBytes = (file) => Buffer.from(fs.readFileSync(path.join(PATCH_DIR, file), 'utf8').replace(/\r\n/g, '\n'));

function safeFile(directory, relative) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || path.posix.normalize(relative) !== relative || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
    throw new Error(`Unsafe MediaBunny patch path: ${relative}`);
  }
  const file = path.join(directory, relative);
  if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw new Error(`Expected regular MediaBunny patch file: ${file}`);
  return file;
}

function definition() {
  const raw = fs.readFileSync(path.join(PATCH_DIR, 'patch.json'));
  const patch = JSON.parse(raw);
  if (patch.format !== 1 || patch.package.name !== 'mediabunny' || patch.package.version !== '1.60.0'
    || JSON.stringify(patch.files.map((file) => file.path).sort()) !== JSON.stringify(FILES)) {
    throw new Error('Unexpected MediaBunny patch definition.');
  }
  for (const item of [...patch.files, ...patch.unchangedFiles, ...patch.artifacts]) {
    for (const digest of [item.originalSha256, item.patchedSha256, item.sha256].filter(Boolean)) {
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid MediaBunny patch checksum.');
    }
  }
  for (const artifact of patch.artifacts) {
    safeFile(PATCH_DIR, artifact.path);
    if (sha256(artifactBytes(artifact.path)) !== artifact.sha256) throw new Error(`Changed MediaBunny patch artifact: ${artifact.path}`);
  }
  return { patch, fingerprint: sha256(JSON.stringify(patch)) };
}

function inspect(rootDir) {
  const { patch, fingerprint } = definition();
  const chordManifest = path.join(rootDir, 'apps/chord/package.json');
  if (JSON.parse(fs.readFileSync(chordManifest, 'utf8')).dependencies?.mediabunny !== patch.package.version) {
    throw new Error('Chord must pin mediabunny to exactly 1.60.0.');
  }
  // require is used only to discover this app's actual package location. Chord
  // runtime imports are separately forced/checked against the modular ESM entry.
  const require = createRequire(chordManifest);
  const requiredEntry = fs.realpathSync(require.resolve('mediabunny'));
  const directory = fs.realpathSync(path.resolve(path.dirname(requiredEntry), '../..'));
  const manifestBytes = fs.readFileSync(safeFile(directory, 'package.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.name !== patch.package.name || manifest.version !== patch.package.version
    || JSON.stringify(manifest.exports) !== JSON.stringify(patch.package.exports)
    || manifest.module !== `./${patch.package.esmEntry}` || manifest.types !== `./${patch.package.typesEntry}`
    || requiredEntry !== path.join(directory, patch.package.exports['.'].node.require)) {
    throw new Error('Unexpected MediaBunny version or export paths.');
  }
  if (sha256(manifestBytes) !== patch.package.manifestSha256) throw new Error('Changed MediaBunny package manifest.');
  for (const item of patch.unchangedFiles) {
    if (sha256(fs.readFileSync(safeFile(directory, item.path))) !== item.sha256) throw new Error(`Changed MediaBunny entry/license: ${item.path}`);
  }
  const inputs = patch.files.map((item) => {
    const file = safeFile(directory, item.path);
    const bytes = fs.readFileSync(file);
    const hash = sha256(bytes);
    const state = hash === item.originalSha256 ? 'original' : hash === item.patchedSha256 ? 'patched' : 'unexpected';
    return { item, file, bytes, state, mode: fs.statSync(file).mode & 0o777 };
  });
  const unexpected = inputs.find((input) => input.state === 'unexpected');
  if (unexpected) throw new Error(`Unexpected MediaBunny contents: ${unexpected.item.path}. ${recovery}`);
  const state = new Set(inputs.map((input) => input.state)).size === 1 ? inputs[0].state : 'mixed';
  return { directory, patch, fingerprint, inputs, state,
    esmEntry: safeFile(directory, patch.package.esmEntry), typesEntry: safeFile(directory, patch.package.typesEntry) };
}

function result(inspection) {
  return { packageDir: inspection.directory, esmEntry: inspection.esmEntry, typesEntry: inspection.typesEntry,
    fingerprint: inspection.fingerprint, patchedFiles: FILES.slice() };
}

export function verifyMediaBunnyPatch({ rootDir = ROOT } = {}) {
  const inspection = inspect(rootDir);
  if (inspection.state !== 'patched') throw new Error('MediaBunny lifecycle patch is missing or incomplete. Run npm run postinstall; Chord requires the complete patched cohort.');
  return result(inspection);
}

export function applyMediaBunnyPatch({ rootDir = ROOT } = {}) {
  const inspection = inspect(rootDir);
  if (inspection.state === 'patched') return result(inspection);
  // Every original hash has already matched. Compute and check EVERY final
  // byte sequence before writing even a staging file.
  const outputs = inspection.inputs.filter((input) => input.state === 'original').map((input) => {
    const lines = input.bytes.toString('utf8').split('\n');
    const output = [];
    let cursor = 0;
    for (const edit of input.item.edits) {
      if (!Number.isInteger(edit.atLine) || edit.atLine < cursor || edit.atLine + edit.remove.length > lines.length
        || ![...edit.remove, ...edit.insert].every((line) => typeof line === 'string' && !line.includes('\n'))
        || JSON.stringify(lines.slice(edit.atLine, edit.atLine + edit.remove.length)) !== JSON.stringify(edit.remove)) {
        throw new Error(`Invalid MediaBunny line edit: ${input.item.path}`);
      }
      output.push(...lines.slice(cursor, edit.atLine), ...edit.insert);
      cursor = edit.atLine + edit.remove.length;
    }
    output.push(...lines.slice(cursor));
    const bytes = Buffer.from(output.join('\n'));
    if (sha256(bytes) !== input.item.patchedSha256) throw new Error(`MediaBunny result checksum mismatch: ${input.item.path}`);
    return { ...input, bytes, temporary: `${input.file}.lumachord-${randomUUID()}.tmp` };
  });
  try {
    for (const output of outputs) fs.writeFileSync(output.temporary, output.bytes, { flag: 'wx', mode: output.mode });
    // Another installer must never be allowed to race this exclusive operation.
    for (const input of inspection.inputs) {
      const expected = input.state === 'original' ? input.item.originalSha256 : input.item.patchedSha256;
      if (sha256(fs.readFileSync(safeFile(inspection.directory, input.item.path))) !== expected) throw new Error('MediaBunny changed during patch preparation.');
    }
    for (const output of outputs) fs.renameSync(output.temporary, output.file);
  } catch (error) {
    // An interruption can leave known original/patched files. Verify refuses to
    // launch; apply can safely resume after the same complete preflight.
    throw new Error(`MediaBunny patch did not finish. ${recovery}`, { cause: error });
  } finally {
    for (const output of outputs) fs.rmSync(output.temporary, { force: true });
  }
  return verifyMediaBunnyPatch({ rootDir });
}

export function mediaBunnyPatchPlugin({ rootDir = ROOT } = {}) {
  const verified = verifyMediaBunnyPatch({ rootDir }); // Verify only: never patch from a build/dev command.
  const moduleDirectory = path.join(verified.packageDir, 'dist/modules');
  const checkModule = (id) => {
    const plain = id.split('?')[0];
    const normalized = plain.replaceAll('\\', '/');
    if (!normalized.includes('/node_modules/mediabunny/')) return;
    const real = fs.realpathSync(plain);
    const relative = path.relative(moduleDirectory, real);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`Chord requires patched modular MediaBunny ESM; rejected ${id}`);
    }
  };
  return {
    name: 'lumachord-verified-mediabunny', enforce: 'pre',
    config: () => ({ resolve: { alias: [{ find: /^mediabunny$/, replacement: verified.esmEntry }] }, optimizeDeps: { exclude: COHORT.slice() } }),
    configResolved(config) {
      if (COHORT.some((name) => !config.optimizeDeps.exclude?.includes(name))
        || config.optimizeDeps.include?.some((name) => COHORT.some((item) => name.includes(item)))) {
        throw new Error('Chord must exclude the MediaBunny cohort from optimized dependency caches.');
      }
    },
    async buildStart() {
      verifyMediaBunnyPatch({ rootDir });
      const importer = path.join(rootDir, 'apps/chord/renderer/index.html');
      const parents = [importer];
      for (const name of COHORT.slice(1)) {
        const extension = await this.resolve(name, importer, { skipSelf: true });
        if (!extension || extension.external) throw new Error(`Cannot resolve Chord codec extension: ${name}`);
        parents.push(extension.id);
      }
      for (const parent of parents) {
        const core = await this.resolve('mediabunny', parent, { skipSelf: true });
        // Vite 6 dev resolves this excluded ESM with its dependency version tag.
        // Accept only that observed decoration, then compare the real file.
        const [file, query, extra] = core?.id.split('?') ?? [];
        const knownQuery = query === undefined || /^v=[a-f0-9]{8}$/.test(query);
        if (!core || core.external || !file || !path.isAbsolute(file) || !knownQuery || extra !== undefined
          || !fs.existsSync(file) || fs.realpathSync(file) !== verified.esmEntry) {
          throw new Error(`Unexpected MediaBunny ESM resolution from ${parent}: ${core?.id ?? 'unresolved'} (external=${Boolean(core?.external)}, expected=${verified.esmEntry})`);
        }
      }
    },
    transform(_code, id) { checkModule(id); },
    moduleParsed(info) { checkModule(info.id); },
    generateBundle() {
      verifyMediaBunnyPatch({ rootDir });
      for (const file of ['LICENSE', 'NOTICE.md', 'upstream.diff', 'patch.json']) {
        const bytes = file === 'patch.json' ? Buffer.from(`${JSON.stringify(definition().patch, null, 2)}\n`) : artifactBytes(file);
        this.emitFile({ type: 'asset', fileName: `licenses/mediabunny/${file}`, source: bytes });
      }
      for (const file of SOURCES) {
        this.emitFile({ type: 'asset', fileName: `licenses/mediabunny/${file}`, source: fs.readFileSync(path.join(verified.packageDir, file)) });
      }
    },
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const mode = process.argv[2];
    if (mode !== 'apply' && mode !== 'verify') throw new Error('Usage: node tool/patch-mediabunny.mjs apply|verify');
    const verified = mode === 'apply' ? applyMediaBunnyPatch() : verifyMediaBunnyPatch();
    console.log(`MediaBunny 1.60.0 lifecycle patch ${verified.fingerprint.slice(0, 12)} verified.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertRequiredEncoders, assertRequiredOutputProtocols, assertSelfContainedMachO, inspectBuildConfiguration,
  mediaEngineExecutableName, resolveMediaEngineSource,
} from './media-engine-platform.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDirectory = path.join(appDirectory, 'vendor', 'ffmpeg');
const markerPath = path.join(vendorDirectory, 'provenance.json');
const development = process.argv.includes('--development');
const platform = process.platform;
const executableName = mediaEngineExecutableName(platform);
const executablePath = path.join(vendorDirectory, 'bin', executableName);
const execOptions = { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 };

function assertAppTarget(target) {
  const relative = path.relative(appDirectory, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Media engine target escaped the Stream workspace.');
  }
}

function probe(executable, flag) {
  return execFileSync(executable, ['-hide_banner', flag], execOptions);
}

/** Feature checks shared by every source: transports, encoders, and (unless development) LGPL licensing. */
function verifyEngine(executable, { allowGpl }) {
  const version = probe(executable, '-version');
  const configuration = inspectBuildConfiguration(version);
  if (configuration.gpl && !allowGpl) throw new Error('The Stream media engine was built with GPL or nonfree components and cannot be redistributed with LumaStream.');
  const license = probe(executable, '-L');
  if (!configuration.gpl && !/Lesser General Public License|LGPL/i.test(license)) throw new Error('The Stream media engine did not identify itself as an LGPL build.');
  const licenseVersion = license.match(/Lesser General Public License[\s\S]*?version (\d+) of the License/i)?.[1]
    ?? license.match(/Lesser General Public License[\s\S]*?version (\d+) or later/i)?.[1];
  assertRequiredOutputProtocols(probe(executable, '-protocols'));
  assertRequiredEncoders(probe(executable, '-encoders'), platform);
  return { configuration, licenseVersion, version: version.match(/^ffmpeg version (\S+)/)?.[1] ?? 'unknown' };
}

async function readMarker() {
  try {
    await access(executablePath);
    return JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    return null;
  }
}

async function replaceVendorDirectory(stagingDirectory) {
  assertAppTarget(vendorDirectory);
  await rm(vendorDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(vendorDirectory), { recursive: true });
  await rename(stagingDirectory, vendorDirectory);
}

async function prepareWindowsDownload(bundle) {
  const existing = await readMarker();
  if (existing?.sha256 === bundle.sha256 && existing.source === 'download') {
    assertRequiredOutputProtocols(probe(executablePath, '-protocols'));
    console.log(`Stream media engine ${bundle.version} is already prepared.`);
    return;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-ffmpeg-'));
  const archivePath = path.join(temporaryDirectory, 'ffmpeg.zip');
  const extractDirectory = path.join(temporaryDirectory, 'extract');
  const replacementDirectory = path.join(temporaryDirectory, 'ffmpeg');
  try {
    await mkdir(extractDirectory, { recursive: true });
    const response = await fetch(bundle.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Could not download the pinned Stream media engine (${response.status}).`);
    const hash = createHash('sha256');
    const hashingStream = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), hashingStream, createWriteStream(archivePath));
    if (hash.digest('hex') !== bundle.sha256) throw new Error('The Stream media engine archive checksum did not match.');

    const archiveLiteral = archivePath.replaceAll("'", "''");
    const extractLiteral = extractDirectory.replaceAll("'", "''");
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${archiveLiteral}' -DestinationPath '${extractLiteral}' -Force`,
    ], { stdio: 'inherit', windowsHide: true });

    const archiveRoot = (await readdir(extractDirectory, { withFileTypes: true })).find((entry) => entry.isDirectory());
    if (!archiveRoot) throw new Error('The Stream media engine archive has no root directory.');
    const sourceBin = path.join(extractDirectory, archiveRoot.name, 'bin');
    const sourceExecutable = path.join(sourceBin, executableName);
    await access(sourceExecutable);
    const verified = verifyEngine(sourceExecutable, { allowGpl: false });
    if (!verified.configuration.shared) throw new Error('The pinned Stream media engine is not a shared-library build.');
    if (!verified.licenseVersion) throw new Error('The Stream media engine did not report its LGPL version.');

    const destinationBin = path.join(replacementDirectory, 'bin');
    await mkdir(destinationBin, { recursive: true });
    const binaries = (await readdir(sourceBin, { withFileTypes: true })).filter((entry) => entry.isFile() && (entry.name === executableName || entry.name.toLowerCase().endsWith('.dll')));
    await Promise.all(binaries.map((entry) => copyFile(path.join(sourceBin, entry.name), path.join(destinationBin, entry.name))));
    await writeFile(path.join(replacementDirectory, 'provenance.json'), JSON.stringify({
      ...bundle,
      source: 'download',
      platform: 'win32-x64',
      license: `LGPL-${verified.licenseVersion}.0-or-later; shared Windows x64 build`,
      sourceRepository: 'https://github.com/FFmpeg/FFmpeg',
    }, null, 2), 'utf8');
    await replaceVendorDirectory(replacementDirectory);
    console.log(`Prepared Stream media engine ${bundle.version} (${binaries.length} files).`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** Copies an operator-supplied static LGPL FFmpeg into the vendor tree after verifying it can ship. */
async function prepareExplicitEngine(sourceExecutable) {
  const resolved = path.resolve(sourceExecutable);
  await access(resolved);
  const verified = verifyEngine(resolved, { allowGpl: false });
  if (platform === 'darwin') {
    try {
      assertSelfContainedMachO(execFileSync('otool', ['-L', resolved], execOptions));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('otool is required to verify the macOS media engine; install the Xcode Command Line Tools.');
      throw error;
    }
  }
  const sha256 = createHash('sha256').update(await readFile(resolved)).digest('hex');
  const existing = await readMarker();
  if (existing?.source === 'explicit' && existing.sha256 === sha256) {
    console.log(`Stream media engine ${verified.version} is already prepared.`);
    return;
  }
  const stagingDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-ffmpeg-'));
  try {
    await mkdir(path.join(stagingDirectory, 'bin'), { recursive: true });
    await copyFile(resolved, path.join(stagingDirectory, 'bin', executableName));
    await chmod(path.join(stagingDirectory, 'bin', executableName), 0o755);
    await writeFile(path.join(stagingDirectory, 'provenance.json'), JSON.stringify({
      source: 'explicit',
      platform: `${platform}-${process.arch}`,
      version: verified.version,
      sha256,
      origin: resolved,
      license: `LGPL-${verified.licenseVersion ?? '2'}.0-or-later; static ${platform} ${process.arch} build`,
      sourceRepository: 'https://github.com/FFmpeg/FFmpeg',
    }, null, 2), 'utf8');
    await replaceVendorDirectory(stagingDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
  console.log(`Prepared Stream media engine ${verified.version} from ${resolved}.`);
}

/** Development only: link the ffmpeg on PATH so `npm run dev` works without a redistributable bundle. */
async function prepareDevelopmentEngine(command) {
  let located;
  try {
    located = execFileSync('/bin/sh', ['-lc', `command -v ${command}`], execOptions).trim();
  } catch {
    located = '';
  }
  if (!located) throw new Error(`No ${command} was found on PATH. Install one (for example \`brew install ffmpeg\`) or set LUMASTREAM_MEDIA_ENGINE.`);
  const resolved = await realpath(located);
  const verified = verifyEngine(resolved, { allowGpl: true });
  if (verified.configuration.gpl) {
    console.warn(`Using the development media engine at ${resolved}. It is a GPL build and is never packaged; set LUMASTREAM_MEDIA_ENGINE to a static LGPL FFmpeg before running dist:mac.`);
  }
  const existing = await readMarker();
  let linkTarget = null;
  try { linkTarget = (await lstat(executablePath)).isSymbolicLink() ? await realpath(executablePath) : null; } catch { /* Not linked yet. */ }
  if (existing?.source === 'development' && linkTarget === resolved) {
    console.log(`Stream development media engine ${verified.version} is already linked.`);
    return;
  }
  const stagingDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-ffmpeg-'));
  try {
    await mkdir(path.join(stagingDirectory, 'bin'), { recursive: true });
    await symlink(resolved, path.join(stagingDirectory, 'bin', executableName));
    await writeFile(path.join(stagingDirectory, 'provenance.json'), JSON.stringify({
      source: 'development',
      platform: `${platform}-${process.arch}`,
      version: verified.version,
      origin: resolved,
      license: verified.configuration.gpl ? 'GPL development build; not redistributable' : 'LGPL development build',
      redistributable: false,
    }, null, 2), 'utf8');
    await replaceVendorDirectory(stagingDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
  console.log(`Linked Stream development media engine ${verified.version} from ${resolved}.`);
}

async function run() {
  assertAppTarget(vendorDirectory);
  const source = resolveMediaEngineSource({ platform, arch: process.arch, env: process.env, development });
  if (source.kind === 'download') await prepareWindowsDownload(source.bundle);
  else if (source.kind === 'explicit') await prepareExplicitEngine(source.executable);
  else if (source.kind === 'path') await prepareDevelopmentEngine(source.command);
  else throw new Error(source.reason);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

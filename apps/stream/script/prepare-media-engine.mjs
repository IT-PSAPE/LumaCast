import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDirectory = path.join(appDirectory, 'vendor', 'ffmpeg');
const bundle = {
  version: '9.0.2-28-g669f5ab083',
  url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-16-13-04/ffmpeg-n9.0.2-28-g669f5ab083-win64-lgpl-shared-9.0.zip',
  sha256: '337bccf4f9ed8594255572907d0c3c19e673894713d63d92664d846c4ad183c8',
};

function assertAppTarget(target) {
  const relative = path.relative(appDirectory, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Media engine target escaped the Stream workspace.');
  }
}

async function run() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('The bundled media engine currently supports Windows x64 only.');
  }
  assertAppTarget(vendorDirectory);
  const executable = path.join(vendorDirectory, 'bin', 'ffmpeg.exe');
  const markerPath = path.join(vendorDirectory, 'provenance.json');
  try {
    const marker = await readFile(markerPath, 'utf8');
    await access(executable);
    const existing = JSON.parse(marker);
    if (existing.sha256 === bundle.sha256 && existing.license === 'LGPL-3.0-or-later; shared Windows x64 build') {
      console.log(`Stream media engine ${bundle.version} is already prepared.`);
      return;
    }
  } catch { /* Download or repair the pinned bundle. */ }

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
    const actualHash = hash.digest('hex');
    if (actualHash !== bundle.sha256) throw new Error('The Stream media engine archive checksum did not match.');

    const archiveLiteral = archivePath.replaceAll("'", "''");
    const extractLiteral = extractDirectory.replaceAll("'", "''");
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${archiveLiteral}' -DestinationPath '${extractLiteral}' -Force`,
    ], { stdio: 'inherit', windowsHide: true });

    const archiveRoot = (await readdir(extractDirectory, { withFileTypes: true })).find((entry) => entry.isDirectory());
    if (!archiveRoot) throw new Error('The Stream media engine archive has no root directory.');
    const sourceBin = path.join(extractDirectory, archiveRoot.name, 'bin');
    const sourceExecutable = path.join(sourceBin, 'ffmpeg.exe');
    await access(sourceExecutable);
    const version = execFileSync(sourceExecutable, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    if (/--enable-gpl|--enable-nonfree/.test(version)) throw new Error('The pinned Stream media engine was built with GPL or nonfree components.');
    if (!/--enable-shared/.test(version) || !/--disable-static/.test(version)) throw new Error('The pinned Stream media engine is not a shared-library build.');
    const license = execFileSync(sourceExecutable, ['-hide_banner', '-L'], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    if (!/Lesser General Public License|LGPL/i.test(license)) throw new Error('The Stream media engine did not identify itself as an LGPL build.');
    const licenseVersion = license.match(/Lesser General Public License[\s\S]*?version (\d+) of the License/i)?.[1]
      ?? license.match(/Lesser General Public License[\s\S]*?version (\d+) or later/i)?.[1];
    if (!licenseVersion) throw new Error('The Stream media engine did not report its LGPL version.');
    const encoders = execFileSync(sourceExecutable, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (!['h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libopenh264', 'aac'].every((name) => new RegExp(`\\b${name}\\b`).test(encoders))) {
      throw new Error('The Stream media engine is missing a required H.264 encoder family or AAC encoder.');
    }

    const destinationBin = path.join(replacementDirectory, 'bin');
    await mkdir(destinationBin, { recursive: true });
    const binaries = (await readdir(sourceBin, { withFileTypes: true })).filter((entry) => entry.isFile() && (entry.name === 'ffmpeg.exe' || entry.name.toLowerCase().endsWith('.dll')));
    await Promise.all(binaries.map((entry) => copyFile(path.join(sourceBin, entry.name), path.join(destinationBin, entry.name))));
    await writeFile(path.join(replacementDirectory, 'provenance.json'), JSON.stringify({
      ...bundle,
      license: 'LGPL-' + licenseVersion + '.0-or-later; shared Windows x64 build',
      buildRepository: 'https://github.com/BtbN/FFmpeg-Builds',
      sourceRepository: 'https://github.com/FFmpeg/FFmpeg',
      buildTag: 'autobuild-2026-10-16-13-04',
    }, null, 2), 'utf8');

    await rm(vendorDirectory, { recursive: true, force: true });
    await mkdir(path.dirname(vendorDirectory), { recursive: true });
    await (await import('node:fs/promises')).rename(replacementDirectory, vendorDirectory);
    console.log(`Prepared Stream media engine ${bundle.version} (${binaries.length} files).`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = path.join(appDir, 'native', 'zoom');
const stageRoot = path.join(nativeDir, 'stage');
const require = createRequire(path.join(appDir, 'package.json'));
const sdkRoot = process.env.ZOOM_MEETING_SDK_ROOT ? path.resolve(process.env.ZOOM_MEETING_SDK_ROOT) : '';
const platform = process.platform;

if (platform !== 'win32' && platform !== 'darwin') throw new Error('Zoom Meeting SDK packages are available for Windows and macOS only.');
if (!sdkRoot) throw new Error('Set ZOOM_MEETING_SDK_ROOT to the extracted Zoom Meeting SDK directory before building the native sender.');
const requiredInputs = platform === 'win32'
  ? [path.join(sdkRoot, 'h'), path.join(sdkRoot, 'lib', 'sdk.lib'), path.join(sdkRoot, 'bin')]
  : [path.join(sdkRoot, 'ZoomSDK.framework'), path.join(sdkRoot, 'protobuf.framework')];
for (const input of requiredInputs) {
  try { await stat(input); }
  catch { throw new Error(`The Zoom SDK directory is incomplete: missing ${input}`); }
}

const electronVersion = require('electron/package.json').version;
const nodeGypCli = require.resolve('node-gyp/bin/node-gyp.js');
const build = spawnSync(process.execPath, [nodeGypCli, 'rebuild', '--directory', nativeDir, `--target=${electronVersion}`, '--dist-url=https://electronjs.org/headers'], {
  cwd: appDir,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, ZOOM_MEETING_SDK_ROOT: sdkRoot },
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const addon = path.join(nativeDir, 'build', 'Release', 'lumastream-zoom-sdk.node');
await stat(addon);
const stageDirectory = path.join(stageRoot, platform === 'win32' ? 'windows' : 'macos');
const licenseDirectory = path.join(stageRoot, 'third-party');
await rm(stageDirectory, { recursive: true, force: true });
await rm(licenseDirectory, { recursive: true, force: true });
await mkdir(stageDirectory, { recursive: true });
await mkdir(licenseDirectory, { recursive: true });
await cp(addon, path.join(stageDirectory, path.basename(addon)));

if (platform === 'win32') {
  await cp(path.join(sdkRoot, 'bin'), path.join(stageDirectory, 'bin'), { recursive: true });
} else {
  for (const name of ['ZoomSDK.framework', 'protobuf.framework']) {
    await cp(path.join(sdkRoot, name), path.join(stageDirectory, name), { recursive: true, dereference: false });
  }
  // The addon loads the vendor frameworks beside itself via its @loader_path runpath.
}

const sdkPackageRoot = platform === 'win32' ? path.dirname(sdkRoot) : path.dirname(sdkRoot);
for (const name of ['OSS-LICENSE.pdf', 'README.md', 'CHANGELOG.md', 'version.txt']) {
  try { await cp(path.join(sdkPackageRoot, name), path.join(licenseDirectory, name)); }
  catch { /* Some extracted SDK layouts keep notices one directory above the selected root. */ }
}
process.stdout.write(`Prepared Zoom Meeting SDK ${platform} runtime for Electron ${electronVersion}.\n`);

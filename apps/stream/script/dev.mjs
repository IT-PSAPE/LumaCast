import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? 'dev';
if (!['dev', 'preview'].includes(mode)) throw new Error('Usage: node script/dev.mjs [dev|preview]');
const mediaEngine = spawnSync(process.execPath, [path.join(appDir, 'script', 'prepare-media-engine.mjs'), '--development'], { cwd: appDir, stdio: 'inherit', windowsHide: true });
if (mediaEngine.error) throw mediaEngine.error;
if (mediaEngine.status !== 0) process.exit(mediaEngine.status ?? 1);
const applicationAudio = spawnSync(process.execPath, [path.join(appDir, 'script', 'prepare-application-audio.mjs')], { cwd: appDir, stdio: 'inherit', windowsHide: true });
if (applicationAudio.error) throw applicationAudio.error;
if (applicationAudio.status !== 0) process.exit(applicationAudio.status ?? 1);
const packagePath = require.resolve('electron-vite/package.json');
const appEnvironment = require('vite').loadEnv('development', path.resolve(appDir, '../..'), '');
const environment = {
  ...process.env,
  ...(appEnvironment.ZOOM_MEETING_SDK_ROOT ? { ZOOM_MEETING_SDK_ROOT: appEnvironment.ZOOM_MEETING_SDK_ROOT } : {}),
  ...(appEnvironment.LUMASTREAM_ZOOM_CLIENT_ID ? { LUMASTREAM_ZOOM_CLIENT_ID: appEnvironment.LUMASTREAM_ZOOM_CLIENT_ID } : {}),
  ...(appEnvironment.LUMASTREAM_ZOOM_CLIENT_SECRET ? { LUMASTREAM_ZOOM_CLIENT_SECRET: appEnvironment.LUMASTREAM_ZOOM_CLIENT_SECRET } : {}),
  ELECTRON_EXEC_PATH: require('electron'),
};
delete environment.ELECTRON_RUN_AS_NODE;
if (environment.ZOOM_MEETING_SDK_ROOT && !existsSync(path.join(appDir, 'native', 'zoom', 'build', 'Release', 'lumastream-zoom-sdk.node'))) {
  const buildEnvironment = { ...environment };
  delete buildEnvironment.LUMASTREAM_ZOOM_CLIENT_ID;
  delete buildEnvironment.LUMASTREAM_ZOOM_CLIENT_SECRET;
  const zoomNative = spawnSync(process.execPath, [path.join(appDir, 'script', 'prepare-zoom-native.mjs')], { cwd: appDir, stdio: 'inherit', windowsHide: true, env: buildEnvironment });
  if (zoomNative.error) throw zoomNative.error;
  if (zoomNative.status !== 0) process.exit(zoomNative.status ?? 1);
}
const child = spawn(process.execPath, [path.join(path.dirname(packagePath), 'bin/electron-vite.js'), mode], {
  cwd: appDir,
  stdio: 'inherit',
  env: environment,
});
child.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', (code) => process.exit(code ?? 1));

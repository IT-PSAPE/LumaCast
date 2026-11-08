import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveAppElectron } from './app-electron.mjs';

if (process.platform !== 'darwin') {
  console.log('NDI Electron direct transport integration is skipped outside macOS');
  process.exit(0);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw Object.assign(new Error(`${command} exited with status ${result.status}`), { exitCode: result.status ?? 1 });
  }
}

let profileDirectory;
try {
  run(npmCommand, ['--prefix', 'packages/ndi-native', 'run', 'build:mock-ndi']);
  // Only Cast owns the NDI host and preload the harness exercises.
  run(npmCommand, ['run', 'build:cast']);
  const electronBinary = resolveAppElectron('cast').binaryPath;
  profileDirectory = mkdtempSync(join(os.tmpdir(), 'lumacast-ndi-profile-'));
  const electronEnvironment = { ...process.env, NDI_FRAME_TRANSPORT_PROFILE_DIR: profileDirectory };
  delete electronEnvironment.ELECTRON_RUN_AS_NODE;
  run(electronBinary, [join(root, 'tool', 'ndi-frame-transport-integration', 'main.cjs')], electronEnvironment);
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode ?? 1;
} finally {
  // Remove Chromium's profile only after the Electron process has exited.
  if (profileDirectory) rmSync(profileDirectory, { recursive: true, force: true });
}

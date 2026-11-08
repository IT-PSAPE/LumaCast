import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { resolveAppElectron } from './app-electron.mjs';
if (process.platform !== 'darwin') {
  console.log('Chromium GPU NDI integration currently requires the macOS mock runtime');
  process.exit(0);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(new Error(`${command} exited with status ${result.status}`), { exitCode: result.status ?? 1 });
}
let profileDirectory;
try {
  run('npm', ['--prefix', 'packages/ndi-native', 'run', 'build:mock-ndi']);
  run('npm', ['run', 'build:cast']);
  const output = join(root, 'node_modules/.cache/ndi-gpu-integration');
  mkdirSync(output, { recursive: true });
  await build({ stdin: { contents: "export { NdiGpuOutput } from './apps/cast/main/ndi/ndi-gpu-output'; export { NdiServiceProxy } from './apps/cast/main/ndi/ndi-service-proxy';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@lumacast/ndi-native'], outfile: join(output, 'manager.cjs') });
  profileDirectory = mkdtempSync(join(os.tmpdir(), 'lumacast-ndi-gpu-profile-'));
  const env = { ...process.env, NDI_GPU_PROFILE_DIR: profileDirectory }; delete env.ELECTRON_RUN_AS_NODE;
  run(resolveAppElectron('cast').binaryPath, [join(root, 'tests/apps/cast/main/ndi/fixtures/gpu-output-integration.cjs')], env);
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode ?? 1;
} finally {
  if (profileDirectory) rmSync(profileDirectory, { recursive: true, force: true });
}

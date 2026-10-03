import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
if (process.platform !== 'darwin') {
  console.log('Chromium GPU NDI integration currently requires the macOS mock runtime');
  process.exit(0);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('npm', ['--prefix', 'packages/ndi-native', 'run', 'build:mock-ndi']);
run('npm', ['run', 'build:cast']);
const output = join(root, 'node_modules/.cache/ndi-gpu-integration');
mkdirSync(output, { recursive: true });
await build({ stdin: { contents: "export { NdiGpuOutput } from './apps/cast/main/ndi/ndi-gpu-output'; export { NdiServiceProxy } from './apps/cast/main/ndi/ndi-service-proxy';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@lumacast/ndi-native'], outfile: join(output, 'manager.cjs') });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
run(join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [join(root, 'tests/apps/cast/main/ndi/fixtures/gpu-output-integration.cjs')], env);

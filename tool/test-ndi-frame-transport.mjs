import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npmCommand, ['--prefix', 'packages/ndi-native', 'run', 'build:mock-ndi']);
run(npmCommand, ['run', 'build']);

const electronBinary = join(
  root,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron',
);
const electronEnvironment = { ...process.env };
delete electronEnvironment.ELECTRON_RUN_AS_NODE;
run(
  electronBinary,
  [join(root, 'tool', 'ndi-frame-transport-integration', 'main.cjs')],
  electronEnvironment,
);

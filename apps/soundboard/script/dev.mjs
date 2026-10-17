import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? 'dev';
if (!['dev', 'preview'].includes(mode)) {
  throw new Error('Usage: node script/dev.mjs [dev|preview]');
}
const packagePath = require.resolve('electron-vite/package.json');
const electronPath = require('electron');
const environment = { ...process.env, ELECTRON_EXEC_PATH: electronPath };
// A shell opened by an Electron-based editor can inherit this variable.
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [path.join(path.dirname(packagePath), 'bin/electron-vite.js'), mode], {
  cwd: appDir,
  stdio: 'inherit',
  env: environment,
});
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code) => process.exit(code ?? 1));

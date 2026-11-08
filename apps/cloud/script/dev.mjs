import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? 'dev';
if (!['dev', 'preview'].includes(mode)) throw new Error('Usage: node script/dev.mjs [dev|preview]');

// Electron 42+ prepares its binary on require; electron-vite 3 only reads path.txt.
const electronPath = require('electron');
const vitePackage = require.resolve('electron-vite/package.json');
const environment = { ...process.env, ELECTRON_EXEC_PATH: electronPath };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [path.join(path.dirname(vitePackage), 'bin/electron-vite.js'), mode], {
  cwd: appDir, stdio: 'inherit', env: environment,
});
child.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

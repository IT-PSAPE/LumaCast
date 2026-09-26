// Dev and preview entry point for apps/chord.
//
// `electron-vite dev`/`preview` start Electron through whatever `electron`
// binary they can resolve, which in this monorepo may be another app's version
// hoisted to the workspace root. LumaChord is pinned to one Electron release,
// so the path is resolved explicitly from *this app* and passed on as
// ELECTRON_EXEC_PATH. `preview` goes through this launcher too, so a previewed
// build runs the same pinned runtime instead of falling back to a hoisted one.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Only these two modes; anything else is a typo, not a mode to pass through to
// the CLI.
const MODES = ['dev', 'preview'];

function resolveElectron() {
  try {
    return require('electron');
  } catch (error) {
    throw new Error(
      `Cannot resolve Electron from apps/chord. Run an install at the workspace root. (${error.message})`,
    );
  }
}

// electron-vite's export map publishes "." and "./package.json" only, so
// `electron-vite/cli.js` is not a resolvable subpath. The bin path is derived
// from the package directory instead, which is stable across releases.
function resolveElectronViteBin() {
  const packageJson = require.resolve('electron-vite/package.json', { paths: [appDir] });
  return path.join(path.dirname(packageJson), 'bin', 'electron-vite.js');
}

const mode = process.argv[2] ?? 'dev';
if (!MODES.includes(mode)) {
  process.stderr.write(
    `Usage: node script/dev.mjs [${MODES.join('|')}] (got ${JSON.stringify(mode)})\n`,
  );
  process.exit(1);
}

const electronPath = resolveElectron();
const vite = resolveElectronViteBin();

const child = spawn(process.execPath, [vite, mode], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_EXEC_PATH: electronPath },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const roots: string[] = [];

function fixture(app: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'app-dev-launcher-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'script'));
  fs.copyFileSync(path.join(repoRoot, 'apps', app, 'script/dev.mjs'), path.join(root, 'script/dev.mjs'));
  const electron = path.join(root, 'node_modules/electron');
  const vite = path.join(root, 'node_modules/electron-vite');
  fs.mkdirSync(electron, { recursive: true });
  fs.mkdirSync(path.join(vite, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(electron, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
  fs.writeFileSync(path.join(electron, 'index.js'), `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(root, 'prepared'))}, 'yes');module.exports=${JSON.stringify(path.join(root, 'Electron'))};`);
  fs.writeFileSync(path.join(vite, 'package.json'), JSON.stringify({ name: 'electron-vite', exports: { './package.json': './package.json' } }));
  fs.writeFileSync(path.join(vite, 'bin/electron-vite.js'), "console.log(JSON.stringify({mode:process.argv[2],cwd:process.cwd(),binary:process.env.ELECTRON_EXEC_PATH,nodeMode:process.env.ELECTRON_RUN_AS_NODE??null}));");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe.each(['cast', 'cloud'])('%s development launcher', (app) => {
  it.each(['dev', 'preview'])('prepares the app runtime before %s and clears inherited Node mode', (mode) => {
    const root = fixture(app);
    const result = spawnSync(process.execPath, [path.join(root, 'script/dev.mjs'), mode], {
      encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, 'prepared'), 'utf8')).toBe('yes');
    expect(JSON.parse(result.stdout)).toEqual({ mode, cwd: root, binary: path.join(root, 'Electron'), nodeMode: null });
  });

  it('rejects unknown modes before preparing a runtime', () => {
    const root = fixture(app);
    const result = spawnSync(process.execPath, [path.join(root, 'script/dev.mjs'), 'unexpected'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[dev|preview]');
    expect(fs.existsSync(path.join(root, 'prepared'))).toBe(false);
  });
});

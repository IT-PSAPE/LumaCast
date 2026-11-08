import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Resolve the app's declared runtime whether npm installs it locally or hoists it. */
export function resolveAppElectron(app, rootDir = ROOT) {
  const manifestPath = path.join(rootDir, 'apps', app, 'package.json');
  const appRequire = createRequire(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expectedVersion = manifest.devDependencies?.electron;
  assert.match(expectedVersion ?? '', /^\d+\.\d+\.\d+$/, `${app} must pin an exact Electron version`);

  const packagePath = appRequire.resolve('electron/package.json');
  const { version } = appRequire(packagePath);
  assert.equal(version, expectedVersion,
    `Expected ${app} Electron ${expectedVersion}, resolved ${version} at ${packagePath}`);
  const binaryPath = appRequire('electron');
  const runtimeVersion = childProcess.execFileSync(binaryPath, ['-p', 'process.versions.electron'], {
    encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim();
  assert.equal(runtimeVersion, expectedVersion,
    `Expected ${app} Electron binary ${expectedVersion}, got ${runtimeVersion} at ${binaryPath}`);
  return { binaryPath, packagePath, version };
}

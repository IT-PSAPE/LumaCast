#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveAppElectron } from '../app-electron.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function prepareAppElectron(app, { rootDir = ROOT, platform = process.platform } = {}) {
  if (typeof app !== 'string' || !/^[a-z][a-z0-9-]*$/.test(app)) {
    throw new Error('Expected --app <workspace name>.');
  }
  // Requiring the selected app's package provisions Electron 44 lazily. The
  // existing resolver then checks both package and actual binary versions.
  const runtime = resolveAppElectron(app, rootDir);
  const sandboxPath = platform === 'linux' ? path.join(path.dirname(runtime.binaryPath), 'chrome-sandbox') : null;
  if (sandboxPath && !fs.lstatSync(sandboxPath).isFile()) {
    throw new Error(`Electron sandbox helper is not a regular file: ${sandboxPath}`);
  }
  return { ...runtime, sandboxPath };
}

export function main(argv, env = process.env, options = {}) {
  let app = env.APP;
  let githubOutput = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--app') app = argv[++index];
    else if (argv[index] === '--github-output') githubOutput = true;
    else throw new Error(`Unknown argument ${argv[index]}.`);
  }
  const runtime = prepareAppElectron(app, options);
  if (githubOutput) {
    if (!env.GITHUB_OUTPUT || !path.isAbsolute(env.GITHUB_OUTPUT)) {
      throw new Error('--github-output requires an absolute GITHUB_OUTPUT path.');
    }
    const values = { binary_path: runtime.binaryPath, package_path: runtime.packagePath,
      version: runtime.version, sandbox_path: runtime.sandboxPath ?? '' };
    for (const value of Object.values(values)) {
      if (/[\r\n]/.test(value)) throw new Error('Runtime output paths must not contain line breaks.');
    }
    // Installer stdout can contain download messages. Paths travel through the
    // output file instead of command substitution or parsing that stdout.
    fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  process.stdout.write(`${app}: Electron ${runtime.version} ready at ${runtime.binaryPath}\n`);
  return runtime;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

// Root-aware on purpose: this script is invoked both as `node
// scripts/ensure-rollup-native.cjs` from the workspace root and as `node
// ../../scripts/ensure-rollup-native.cjs` from inside apps/* (their
// predev/prebuild hooks). Native packages are installed once, in the root
// node_modules, so every lookup below anchors at the repo root derived from
// this file's location — never at process.cwd(), which is the invoking
// package's directory under workspaces.
const REPO_ROOT = path.resolve(__dirname, '..');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmExecOptions = {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: REPO_ROOT,
};

function getInstalledPackageVersion(packageName) {
  const packageJsonPath = path.join(REPO_ROOT, 'node_modules', ...packageName.split('/'), 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`${packageName} is not installed. Run npm install from the workspace root before ensure-rollup-native.`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

function isMusl() {
  const report = typeof process.report?.getReport === 'function'
    ? process.report.getReport()
    : null;

  return !report?.header?.glibcVersionRuntime;
}

function getRollupPlatformPackageName() {
  const { platform, arch } = process;

  if (platform === 'darwin') {
    if (arch === 'arm64') return '@rollup/rollup-darwin-arm64';
    if (arch === 'x64') return '@rollup/rollup-darwin-x64';
    return null;
  }

  if (platform === 'linux') {
    if (arch === 'x64') return isMusl() ? '@rollup/rollup-linux-x64-musl' : '@rollup/rollup-linux-x64-gnu';
    if (arch === 'arm64') return isMusl() ? '@rollup/rollup-linux-arm64-musl' : '@rollup/rollup-linux-arm64-gnu';
    if (arch === 'arm') return isMusl() ? '@rollup/rollup-linux-arm-musleabihf' : '@rollup/rollup-linux-arm-gnueabihf';
    return null;
  }

  if (platform === 'win32') {
    if (arch === 'x64') return '@rollup/rollup-win32-x64-msvc';
    if (arch === 'arm64') return '@rollup/rollup-win32-arm64-msvc';
    if (arch === 'ia32') return '@rollup/rollup-win32-ia32-msvc';
    return null;
  }

  return null;
}

function getLightningCssPlatformPackageName() {
  const { platform, arch } = process;

  if (platform === 'darwin') {
    if (arch === 'arm64') return 'lightningcss-darwin-arm64';
    if (arch === 'x64') return 'lightningcss-darwin-x64';
    return null;
  }

  if (platform === 'linux') {
    if (arch === 'x64') return isMusl() ? 'lightningcss-linux-x64-musl' : 'lightningcss-linux-x64-gnu';
    if (arch === 'arm64') return isMusl() ? 'lightningcss-linux-arm64-musl' : 'lightningcss-linux-arm64-gnu';
    if (arch === 'arm') return 'lightningcss-linux-arm-gnueabihf';
    return null;
  }

  if (platform === 'win32') {
    if (arch === 'x64') return 'lightningcss-win32-x64-msvc';
    if (arch === 'arm64') return 'lightningcss-win32-arm64-msvc';
    return null;
  }

  return null;
}

function getTailwindOxidePlatformPackageName() {
  const { platform, arch } = process;

  if (platform === 'darwin') {
    if (arch === 'arm64') return '@tailwindcss/oxide-darwin-arm64';
    if (arch === 'x64') return '@tailwindcss/oxide-darwin-x64';
    return null;
  }

  if (platform === 'linux') {
    if (arch === 'x64') return isMusl() ? '@tailwindcss/oxide-linux-x64-musl' : '@tailwindcss/oxide-linux-x64-gnu';
    if (arch === 'arm64') return isMusl() ? '@tailwindcss/oxide-linux-arm64-musl' : '@tailwindcss/oxide-linux-arm64-gnu';
    if (arch === 'arm') return '@tailwindcss/oxide-linux-arm-gnueabihf';
    return null;
  }

  if (platform === 'win32') {
    if (arch === 'x64') return '@tailwindcss/oxide-win32-x64-msvc';
    if (arch === 'arm64') return '@tailwindcss/oxide-win32-arm64-msvc';
    return null;
  }

  return null;
}

function hasPackage(packageName) {
  try {
    require.resolve(packageName, { paths: [REPO_ROOT] });
    return true;
  } catch {
    return false;
  }
}

function collectMissingNativePackage({
  dependencyName,
  packageName,
}) {
  if (!packageName) {
    console.warn(`[ensure-rollup-native] No platform package mapping for ${dependencyName} on ${process.platform}/${process.arch}; skipping.`);
    return null;
  }

  if (hasPackage(packageName)) {
    console.log(`[ensure-rollup-native] Found ${packageName}.`);
    return null;
  }

  const version = getInstalledPackageVersion(dependencyName);
  return { packageName, version };
}

const missingPackages = [
  collectMissingNativePackage({
    dependencyName: 'rollup',
    packageName: getRollupPlatformPackageName(),
  }),
  collectMissingNativePackage({
    dependencyName: 'lightningcss',
    packageName: getLightningCssPlatformPackageName(),
  }),
  collectMissingNativePackage({
    dependencyName: '@tailwindcss/oxide',
    packageName: getTailwindOxidePlatformPackageName(),
  }),
].filter(Boolean);

if (missingPackages.length > 0) {
  const packagesToInstall = missingPackages.map(({ packageName, version }) => `${packageName}@${version}`);
  console.log(`[ensure-rollup-native] Installing missing native packages: ${packagesToInstall.join(', ')}.`);
  execFileSync(npmCommand, ['install', '--no-save', ...packagesToInstall], npmExecOptions);
}

for (const { packageName } of missingPackages) {
  if (!hasPackage(packageName)) {
    throw new Error(`[ensure-rollup-native] Failed to install ${packageName}.`);
  }
  console.log(`[ensure-rollup-native] Verified ${packageName}.`);
}

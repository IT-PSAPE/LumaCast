// Shared test support for apps/cloud/main/platform/**: SUITE_APPS-shaped
// descriptor literals (never imported from @lumacast/suite's runtime
// registry — that package is being written concurrently; only its types are
// safe to depend on), a Map-backed fake PlatformFs, a scripted ExecFn that
// records every call, and per-host PlatformEnv builders. Not itself a test
// file (vitest only picks up tests/**/*.test.ts).
import nodePath from 'node:path';
import type { SuiteAppDescriptor } from '@lumacast/suite';
import type {
  ExecFn,
  ExecResult,
  PlatformEnv,
  PlatformFs,
} from '../../../../../apps/cloud/main/platform/adapter';

export const CAST_APP: SuiteAppDescriptor = {
  id: 'cast',
  productName: 'LumaCast',
  bundleId: 'com.lumacast.app',
  summary: 'Presentation and NDI output',
  versionScheme: 'semver',
  releaseTagPrefix: 'cast-v',
  legacyTagPrefix: 'v',
  feedTag: 'cast-feed',
  mac: { bundleName: 'LumaCast.app' },
  win: { executableName: 'LumaCast.exe', displayName: 'LumaCast' },
  linux: { executableName: 'lumacast', debPackageName: 'lumacast' },
};

export const FLUX_APP: SuiteAppDescriptor = {
  id: 'flux',
  productName: 'Lumaflux',
  bundleId: 'app.lumaflux.desktop',
  summary: 'Photo editing with agent automation',
  versionScheme: 'semver-revision',
  releaseTagPrefix: 'flux-v',
  legacyTagPrefix: null,
  feedTag: 'flux-feed',
  mac: { bundleName: 'Lumaflux.app' },
  win: { executableName: 'Lumaflux.exe', displayName: 'Lumaflux' },
  linux: { executableName: 'lumaflux', debPackageName: 'lumaflux' },
};

export const CLOUD_APP: SuiteAppDescriptor = {
  id: 'cloud',
  productName: 'LumaCloud',
  bundleId: 'com.lumacast.cloud',
  summary: 'Installs and updates the suite',
  versionScheme: 'semver',
  releaseTagPrefix: 'cloud-v',
  legacyTagPrefix: null,
  feedTag: 'cloud-feed',
  mac: { bundleName: 'LumaCloud.app' },
  win: { executableName: 'LumaCloud.exe', displayName: 'LumaCloud' },
  linux: { executableName: 'lumacloud', debPackageName: 'lumacloud' },
};

export function darwinEnv(overrides: Partial<PlatformEnv> = {}): PlatformEnv {
  return {
    platform: 'darwin',
    arch: 'arm64',
    homeDir: '/Users/test',
    appDataDir: '/Users/test/Library/Application Support',
    downloadsDir: '/Users/test/Library/Application Support/lumacloud/downloads',
    ...overrides,
  };
}

export function win32Env(overrides: Partial<PlatformEnv> = {}): PlatformEnv {
  return {
    platform: 'win32',
    arch: 'x64',
    homeDir: 'C:\\Users\\test',
    appDataDir: 'C:\\Users\\test\\AppData\\Roaming',
    downloadsDir: 'C:\\Users\\test\\AppData\\Roaming\\lumacloud\\downloads',
    ...overrides,
  };
}

export function linuxEnv(overrides: Partial<PlatformEnv> = {}): PlatformEnv {
  return {
    platform: 'linux',
    arch: 'x64',
    homeDir: '/home/test',
    appDataDir: '/home/test/.config',
    downloadsDir: '/home/test/.config/lumacloud/downloads',
    ...overrides,
  };
}

/** Picks the path-splitting rules to use for a fake-fs key: win32 when it
 * looks like a Windows path (a drive letter or a backslash), posix otherwise
 * — so the same fake works for darwin/linux tests (forward slashes) and
 * win32 tests (backslashes) without the fake caring which suite runs it. */
function pathModuleFor(value: string): typeof nodePath.posix {
  return /^[a-zA-Z]:\\|\\\\|\\/.test(value) ? nodePath.win32 : nodePath.posix;
}

export interface FakeFsState {
  files: Map<string, string>;
  dirs: Set<string>;
  writableDirs: Set<string>;
  /** Paths whose `rename` should reject with an EXDEV-shaped error. */
  failRenameFrom: Set<string>;
  trashed: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  copied: Array<{ from: string; to: string }>;
  chmods: Array<{ path: string; mode: number }>;
}

export interface FakeFs {
  fs: PlatformFs;
  state: FakeFsState;
}

function isUnder(key: string, base: string, sep: string): boolean {
  return key === base || key.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

export function createFakeFs(initial?: {
  files?: Record<string, string>;
  dirs?: string[];
  writableDirs?: string[];
}): FakeFs {
  const state: FakeFsState = {
    files: new Map(Object.entries(initial?.files ?? {})),
    dirs: new Set(initial?.dirs ?? []),
    writableDirs: new Set(initial?.writableDirs ?? []),
    failRenameFrom: new Set(),
    trashed: [],
    removed: [],
    renamed: [],
    copied: [],
    chmods: [],
  };

  function removeAll(target: string): void {
    const pm = pathModuleFor(target);
    for (const key of [...state.files.keys()]) {
      if (isUnder(key, target, pm.sep)) {
        state.files.delete(key);
      }
    }
    for (const key of [...state.dirs]) {
      if (isUnder(key, target, pm.sep)) {
        state.dirs.delete(key);
      }
    }
  }

  const fs: PlatformFs = {
    exists: async (path) => state.files.has(path) || state.dirs.has(path),
    readFile: async (path) => {
      const content = state.files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file ${path}`);
      }
      return content;
    },
    readDir: async (dir) => {
      const pm = pathModuleFor(dir);
      const normalizedDir = pm.normalize(dir);
      const names = new Set<string>();
      for (const key of [...state.files.keys(), ...state.dirs]) {
        if (key === normalizedDir) continue;
        const parent = pm.dirname(pm.normalize(key));
        if (parent === normalizedDir) {
          names.add(pm.basename(key));
        }
      }
      if (names.size === 0 && !state.dirs.has(normalizedDir)) {
        throw new Error(`ENOENT: no such directory ${dir}`);
      }
      return [...names];
    },
    mkdir: async (path) => {
      const pm = pathModuleFor(path);
      let current = path;
      const chain: string[] = [];
      // Walk up to the root recording every ancestor, then add them all —
      // approximates `{recursive: true}` closely enough for these tests.
      for (let i = 0; i < 32; i += 1) {
        chain.push(current);
        const parent = pm.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      for (const dir of chain) {
        state.dirs.add(dir);
      }
    },
    copyFile: async (from, to) => {
      const content = state.files.get(from);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file ${from}`);
      }
      state.files.set(to, content);
      state.copied.push({ from, to });
    },
    rename: async (from, to) => {
      if (state.failRenameFrom.has(from)) {
        const error = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
        error.code = 'EXDEV';
        throw error;
      }
      const pm = pathModuleFor(from);
      const movedFiles: Array<[string, string]> = [];
      for (const key of state.files.keys()) {
        if (isUnder(key, from, pm.sep)) {
          movedFiles.push([key, to + key.slice(from.length)]);
        }
      }
      for (const [oldKey, newKey] of movedFiles) {
        state.files.set(newKey, state.files.get(oldKey) as string);
        state.files.delete(oldKey);
      }
      const movedDirs: Array<[string, string]> = [];
      for (const key of state.dirs) {
        if (isUnder(key, from, pm.sep)) {
          movedDirs.push([key, to + key.slice(from.length)]);
        }
      }
      for (const [oldKey, newKey] of movedDirs) {
        state.dirs.delete(oldKey);
        state.dirs.add(newKey);
      }
      state.renamed.push({ from, to });
    },
    remove: async (path) => {
      removeAll(path);
      state.removed.push(path);
    },
    chmod: async (path, mode) => {
      state.chmods.push({ path, mode });
    },
    writable: async (path) => state.writableDirs.has(path),
    trash: async (path) => {
      removeAll(path);
      state.trashed.push(path);
    },
  };

  return { fs, state };
}

export interface ScriptedExecCall {
  file: string;
  args: readonly string[];
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal };
}

export interface ScriptedExec {
  exec: ExecFn;
  calls: ScriptedExecCall[];
}

/** Default result for any call the test's responder doesn't care about. */
export const OK: ExecResult = { code: 0, stdout: '', stderr: '' };

export function createScriptedExec(
  responder: (call: ScriptedExecCall) => ExecResult | Promise<ExecResult>,
): ScriptedExec {
  const calls: ScriptedExecCall[] = [];
  const exec: ExecFn = async (file, args, options) => {
    const call: ScriptedExecCall = { file, args, options };
    calls.push(call);
    return responder(call);
  };
  return { exec, calls };
}

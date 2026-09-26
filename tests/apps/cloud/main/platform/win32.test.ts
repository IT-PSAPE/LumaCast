import { describe, expect, it, vi } from 'vitest';
import type { ExecResult, InstallRequest, PlatformAdapterDeps, UninstallRequest } from '../../../../../apps/cloud/main/platform/adapter';
import { createWin32PlatformAdapter } from '../../../../../apps/cloud/main/platform/win32';
import {
  CAST_APP,
  CLOUD_APP,
  createFakeFs,
  createScriptedExec,
  win32Env,
  type FakeFsState,
  type ScriptedExecCall,
} from './fixtures';

const UNINSTALL_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

function regEntry(displayName: string, values: Record<string, string> = {}): string {
  const lines = [
    `HKEY_CURRENT_USER\\${UNINSTALL_KEY}\\LumaCast`,
    `    DisplayName    REG_SZ    ${displayName}`,
    ...Object.entries(values).map(([name, value]) => `    ${name}    REG_SZ    ${value}`),
    '',
  ];
  return lines.join('\r\n');
}

interface Rig {
  deps: PlatformAdapterDeps;
  fs: FakeFsState;
  calls: ScriptedExecCall[];
}

function createRig(options: {
  files?: Record<string, string>;
  dirs?: string[];
  writableDirs?: string[];
  spawnDetached?: PlatformAdapterDeps['spawnDetached'];
  exec: (call: ScriptedExecCall) => ExecResult;
}): Rig {
  const fakeFs = createFakeFs({ files: options.files, dirs: options.dirs, writableDirs: options.writableDirs });
  const scripted = createScriptedExec(options.exec);
  return {
    deps: { env: win32Env(), fs: fakeFs.fs, exec: scripted.exec, spawnDetached: options.spawnDetached },
    fs: fakeFs.state,
    calls: scripted.calls,
  };
}

function emptyReg(): ExecResult {
  return { code: 0, stdout: '', stderr: '' };
}

describe('win32 platform adapter', () => {
  it('installLocations: user is %LOCALAPPDATA%\\Programs, system is C:\\Program Files', () => {
    const rig = createRig({ exec: () => emptyReg() });
    const adapter = createWin32PlatformAdapter(rig.deps);
    expect(adapter.installLocations()).toEqual({
      user: 'C:\\Users\\test\\AppData\\Local\\Programs',
      system: 'C:\\Program Files',
    });
  });

  it('systemScopeWritable reads C:\\Program Files', async () => {
    const rig = createRig({ writableDirs: ['C:\\Program Files'], exec: () => emptyReg() });
    const adapter = createWin32PlatformAdapter(rig.deps);
    await expect(adapter.systemScopeWritable()).resolves.toBe(true);
  });

  describe('discover', () => {
    it('finds a user (HKCU) uninstall entry', async () => {
      const rig = createRig({
        exec: (call) => {
          if (call.args[1]?.startsWith('HKCU')) {
            return {
              code: 0,
              stdout: regEntry('LumaCast', {
                DisplayVersion: '1.2.3',
                InstallLocation: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
              }),
              stderr: '',
            };
          }
          return emptyReg();
        },
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toEqual({
        app: 'cast',
        version: '1.2.3',
        location: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
        scope: 'user',
      });
      const hkcuCall = rig.calls.find((call) => call.args[1]?.startsWith('HKCU'));
      expect(hkcuCall?.file).toBe('reg');
      expect(hkcuCall?.args).toEqual(['query', `HKCU\\${UNINSTALL_KEY}`, '/s']);
    });

    it('falls back to a system (HKLM) uninstall entry when HKCU has none', async () => {
      const rig = createRig({
        exec: (call) => {
          if (call.args[1]?.startsWith('HKLM')) {
            return {
              code: 0,
              stdout: regEntry('LumaCast', {
                DisplayVersion: '2.0.0',
                InstallLocation: 'C:\\Program Files\\LumaCast',
              }),
              stderr: '',
            };
          }
          return emptyReg();
        },
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toEqual({
        app: 'cast',
        version: '2.0.0',
        location: 'C:\\Program Files\\LumaCast',
        scope: 'system',
      });
    });

    it('ignores an entry whose DisplayName does not match', async () => {
      const rig = createRig({
        exec: () => ({ code: 0, stdout: regEntry('Some Other App', { DisplayVersion: '9.9.9' }), stderr: '' }),
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toBeNull();
    });

    it('probes for the executable but still reports not-installed when no registry entry exists', async () => {
      const rig = createRig({
        dirs: ['C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast'],
        files: { 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\LumaCast.exe': 'binary' },
        exec: () => emptyReg(),
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toBeNull();
    });

    it('returns null when the registry query itself fails', async () => {
      const rig = createRig({ exec: () => ({ code: 1, stdout: '', stderr: 'access denied' }) });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toBeNull();
    });
  });

  describe('install', () => {
    function baseRequest(overrides: Partial<InstallRequest> = {}): InstallRequest {
      return {
        app: CAST_APP,
        artifact: { kind: 'win-nsis', name: 'LumaCast-1.2.3-x64-win.exe', url: 'https://x', sha512: 'x', size: 1 },
        artifactPath: 'C:\\Users\\test\\AppData\\Roaming\\lumacloud\\downloads\\LumaCast-1.2.3-x64-win.exe',
        scope: 'user',
        ...overrides,
      };
    }

    it('runs the installer silently with /S, then discovers the result', async () => {
      const rig = createRig({
        exec: (call) => {
          if (call.file === baseRequest().artifactPath) {
            return { code: 0, stdout: '', stderr: '' };
          }
          if (call.args[1]?.startsWith('HKCU')) {
            return {
              code: 0,
              stdout: regEntry('LumaCast', {
                DisplayVersion: '1.2.3',
                InstallLocation: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
              }),
              stderr: '',
            };
          }
          return emptyReg();
        },
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      const installed = await adapter.install(baseRequest());
      expect(installed).toEqual({
        app: 'cast',
        version: '1.2.3',
        location: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
        scope: 'user',
      });
      const installerCall = rig.calls.find((call) => call.file === baseRequest().artifactPath);
      expect(installerCall?.args).toEqual(['/S']);
      expect(installerCall?.options?.timeoutMs).toBe(10 * 60 * 1000);
    });

    it('throws when the installer exits non-zero', async () => {
      const rig = createRig({
        exec: (call) =>
          call.file === baseRequest().artifactPath
            ? { code: 1, stdout: '', stderr: 'install failed' }
            : emptyReg(),
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.install(baseRequest())).rejects.toThrow(/install failed/);
    });

    it('throws when the artifact kind is not win-nsis', async () => {
      const rig = createRig({ exec: () => emptyReg() });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(
        adapter.install(
          baseRequest({
            artifact: { kind: 'mac-zip', name: 'x.zip', url: 'https://x', sha512: 'x', size: 1 },
          }),
        ),
      ).rejects.toThrow(/win-nsis/);
    });

    it('throws when the app cannot be found after a successful install', async () => {
      const rig = createRig({ exec: () => emptyReg() });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.install(baseRequest())).rejects.toThrow(/not found afterward/);
    });

    it('refuses to install LumaCloud onto itself', async () => {
      const rig = createRig({ exec: () => emptyReg() });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.install(baseRequest({ app: CLOUD_APP }))).rejects.toThrow(
        'LumaCloud cannot install or remove itself',
      );
    });
  });

  describe('uninstall', () => {
    function baseUninstall(overrides: Partial<UninstallRequest> = {}): UninstallRequest {
      return {
        app: CAST_APP,
        installed: {
          app: 'cast',
          version: '1.2.3',
          location: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
          scope: 'user',
        },
        removeUserData: false,
        ...overrides,
      };
    }

    it('prefers QuietUninstallString', async () => {
      const uninstallExe = 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\Uninstall LumaCast.exe';
      const rig = createRig({
        exec: (call) => {
          if (call.args[1]?.startsWith('HKCU')) {
            return {
              code: 0,
              stdout: regEntry('LumaCast', {
                UninstallString: uninstallExe,
                QuietUninstallString: `"${uninstallExe}" /S`,
              }),
              stderr: '',
            };
          }
          return emptyReg();
        },
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall());
      const uninstallCall = rig.calls.find((call) => call.file === uninstallExe);
      expect(uninstallCall?.args).toEqual(['/S']);
    });

    it('falls back to UninstallString + /S when there is no QuietUninstallString', async () => {
      const uninstallExe = 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\Uninstall LumaCast.exe';
      const rig = createRig({
        exec: (call) => {
          if (call.args[1]?.startsWith('HKCU')) {
            return {
              code: 0,
              stdout: regEntry('LumaCast', { UninstallString: `"${uninstallExe}"` }),
              stderr: '',
            };
          }
          return emptyReg();
        },
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall());
      const uninstallCall = rig.calls.find((call) => call.file === uninstallExe);
      expect(uninstallCall?.args).toEqual(['/S']);
    });

    it('throws when the uninstaller exits non-zero', async () => {
      const uninstallExe = 'C:\\Uninstall.exe';
      const rig = createRig({
        exec: (call) => {
          if (call.args[1]?.startsWith('HKCU')) {
            return { code: 0, stdout: regEntry('LumaCast', { QuietUninstallString: uninstallExe }), stderr: '' };
          }
          if (call.file === uninstallExe) {
            return { code: 1, stdout: '', stderr: 'uninstall failed' };
          }
          return emptyReg();
        },
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.uninstall(baseUninstall())).rejects.toThrow(/uninstall failed/);
    });

    it('throws when there is no registry entry to uninstall from', async () => {
      const rig = createRig({ exec: () => emptyReg() });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(adapter.uninstall(baseUninstall())).rejects.toThrow(/No uninstall registry entry/);
    });

    it('removes user-data and updater-cache dirs when removeUserData is set', async () => {
      const uninstallExe = 'C:\\Uninstall.exe';
      const rig = createRig({
        dirs: [
          'C:\\Users\\test\\AppData\\Roaming\\LumaCast',
          'C:\\Users\\test\\AppData\\Local\\lumacast-updater',
        ],
        exec: (call) => {
          if (call.args[1]?.startsWith('HKCU')) {
            return { code: 0, stdout: regEntry('LumaCast', { QuietUninstallString: uninstallExe }), stderr: '' };
          }
          return emptyReg();
        },
      });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall({ removeUserData: true }));
      expect(rig.fs.removed).toContain('C:\\Users\\test\\AppData\\Roaming\\LumaCast');
      expect(rig.fs.removed).toContain('C:\\Users\\test\\AppData\\Local\\lumacast-updater');
    });

    it('refuses to uninstall LumaCloud from itself', async () => {
      const rig = createRig({ exec: () => emptyReg() });
      const adapter = createWin32PlatformAdapter(rig.deps);
      await expect(
        adapter.uninstall(baseUninstall({ app: CLOUD_APP, installed: { ...baseUninstall().installed, app: 'cloud' } })),
      ).rejects.toThrow('LumaCloud cannot install or remove itself');
    });
  });

  it('launch spawns the executable detached', async () => {
    const spawnDetached = vi.fn().mockResolvedValue(undefined);
    const rig = createRig({ exec: () => emptyReg(), spawnDetached });
    const adapter = createWin32PlatformAdapter(rig.deps);
    await adapter.launch(CAST_APP, {
      app: 'cast',
      version: '1.2.3',
      location: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
      scope: 'user',
    });
    expect(spawnDetached).toHaveBeenCalledWith('C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\LumaCast.exe', []);
  });

  it('launch throws when spawnDetached was not provided', async () => {
    const rig = createRig({ exec: () => emptyReg() });
    const adapter = createWin32PlatformAdapter(rig.deps);
    await expect(
      adapter.launch(CAST_APP, {
        app: 'cast',
        version: '1.2.3',
        location: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
        scope: 'user',
      }),
    ).rejects.toThrow(/spawnDetached/);
  });

  it('revealPath is the install directory', () => {
    const rig = createRig({ exec: () => emptyReg() });
    const adapter = createWin32PlatformAdapter(rig.deps);
    expect(
      adapter.revealPath({
        app: 'cast',
        version: '1.2.3',
        location: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
        scope: 'user',
      }),
    ).toBe('C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast');
  });
});

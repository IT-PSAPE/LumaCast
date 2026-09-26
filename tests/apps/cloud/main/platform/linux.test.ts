import { describe, expect, it, vi } from 'vitest';
import type { ExecResult, InstallRequest, PlatformAdapterDeps, UninstallRequest } from '../../../../../apps/cloud/main/platform/adapter';
import { createLinuxPlatformAdapter } from '../../../../../apps/cloud/main/platform/linux';
import {
  CAST_APP,
  CLOUD_APP,
  createFakeFs,
  createScriptedExec,
  linuxEnv,
  OK,
  type FakeFsState,
  type ScriptedExecCall,
} from './fixtures';

interface Rig {
  deps: PlatformAdapterDeps;
  fs: FakeFsState;
  calls: ScriptedExecCall[];
}

function createRig(options: {
  files?: Record<string, string>;
  dirs?: string[];
  spawnDetached?: PlatformAdapterDeps['spawnDetached'];
  exec: (call: ScriptedExecCall) => ExecResult;
}): Rig {
  const fakeFs = createFakeFs({ files: options.files, dirs: options.dirs });
  const scripted = createScriptedExec(options.exec);
  return {
    deps: { env: linuxEnv(), fs: fakeFs.fs, exec: scripted.exec, spawnDetached: options.spawnDetached },
    fs: fakeFs.state,
    calls: scripted.calls,
  };
}

const NOT_FOUND: ExecResult = { code: 1, stdout: '', stderr: 'not found' };

describe('linux platform adapter', () => {
  it('installLocations: user is ~/Applications, system is /opt', () => {
    const rig = createRig({ exec: () => NOT_FOUND });
    const adapter = createLinuxPlatformAdapter(rig.deps);
    expect(adapter.installLocations()).toEqual({ user: '/home/test/Applications', system: '/opt' });
  });

  it('systemScopeWritable reads /opt', async () => {
    const fakeFs = createFakeFs({ writableDirs: ['/opt'] });
    const adapter = createLinuxPlatformAdapter({
      env: linuxEnv(),
      fs: fakeFs.fs,
      exec: createScriptedExec(() => NOT_FOUND).exec,
    });
    await expect(adapter.systemScopeWritable()).resolves.toBe(true);
  });

  describe('discover', () => {
    it('finds a dpkg-installed deb package first', async () => {
      const rig = createRig({
        exec: (call) => (call.file === 'dpkg-query' ? { code: 0, stdout: '1.2.3\n', stderr: '' } : NOT_FOUND),
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toEqual({
        app: 'cast',
        version: '1.2.3',
        location: '/opt/LumaCast',
        scope: 'system',
      });
      const dpkgCall = rig.calls.find((call) => call.file === 'dpkg-query');
      expect(dpkgCall?.args).toEqual(['-W', '-f=${Version}', 'lumacast']);
    });

    it('falls back to an AppImage in ~/Applications when no deb is installed', async () => {
      const rig = createRig({
        dirs: ['/home/test/Applications'],
        files: { '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage': 'binary' },
        exec: () => NOT_FOUND,
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toEqual({
        app: 'cast',
        version: '1.2.3',
        location: '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage',
        scope: 'user',
      });
    });

    it('matches an AppImage without an arch token', async () => {
      const rig = createRig({
        dirs: ['/home/test/Applications'],
        files: { '/home/test/Applications/LumaCast-1.2.3-linux.AppImage': 'binary' },
        exec: () => NOT_FOUND,
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toMatchObject({ version: '1.2.3' });
    });

    it('ignores an AppImage belonging to a different product', async () => {
      const rig = createRig({
        dirs: ['/home/test/Applications'],
        files: { '/home/test/Applications/Lumaflux-1.0.0-x64-linux.AppImage': 'binary' },
        exec: () => NOT_FOUND,
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toBeNull();
    });

    it('returns null when neither a deb nor an AppImage is present', async () => {
      const rig = createRig({ exec: () => NOT_FOUND });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toBeNull();
    });
  });

  describe('install', () => {
    function appImageRequest(overrides: Partial<InstallRequest> = {}): InstallRequest {
      return {
        app: CAST_APP,
        artifact: {
          kind: 'linux-appimage',
          name: 'LumaCast-1.2.3-x64-linux.AppImage',
          url: 'https://x',
          sha512: 'x',
          size: 1,
        },
        artifactPath: '/home/test/.config/lumacloud/downloads/LumaCast-1.2.3-x64-linux.AppImage',
        scope: 'user',
        ...overrides,
      };
    }

    it('copies the AppImage into ~/Applications, chmods it 0o755, and discovers it', async () => {
      const rig = createRig({ dirs: ['/home/test/Applications'], exec: () => NOT_FOUND });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      const installed = await adapter.install(appImageRequest());
      expect(installed).toEqual({
        app: 'cast',
        version: '1.2.3',
        location: '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage',
        scope: 'user',
      });
      expect(rig.fs.copied).toEqual([
        {
          from: '/home/test/.config/lumacloud/downloads/LumaCast-1.2.3-x64-linux.AppImage',
          to: '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage',
        },
      ]);
      expect(rig.fs.chmods).toEqual([
        { path: '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage', mode: 0o755 },
      ]);
    });

    it('removes an older AppImage of the same product', async () => {
      const rig = createRig({
        dirs: ['/home/test/Applications'],
        files: { '/home/test/Applications/LumaCast-1.0.0-x64-linux.AppImage': 'old binary' },
        exec: () => NOT_FOUND,
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await adapter.install(appImageRequest());
      expect(rig.fs.removed).toContain('/home/test/Applications/LumaCast-1.0.0-x64-linux.AppImage');
      expect(rig.fs.files.has('/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage')).toBe(true);
    });

    it('installs a deb package with pkexec dpkg -i', async () => {
      const rig = createRig({
        exec: (call) => {
          if (call.file === 'pkexec') {
            return OK;
          }
          if (call.file === 'dpkg-query') {
            return { code: 0, stdout: '1.2.3\n', stderr: '' };
          }
          return NOT_FOUND;
        },
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      const request: InstallRequest = {
        app: CAST_APP,
        artifact: { kind: 'linux-deb', name: 'LumaCast-1.2.3-x64-linux.deb', url: 'https://x', sha512: 'x', size: 1 },
        artifactPath: '/home/test/.config/lumacloud/downloads/LumaCast-1.2.3-x64-linux.deb',
        scope: 'system',
      };
      const installed = await adapter.install(request);
      expect(installed.location).toBe('/opt/LumaCast');
      const pkexecCall = rig.calls.find((call) => call.file === 'pkexec');
      expect(pkexecCall?.args).toEqual(['dpkg', '-i', request.artifactPath]);
    });

    it('throws when pkexec dpkg -i fails', async () => {
      const rig = createRig({
        exec: (call) => (call.file === 'pkexec' ? { code: 1, stdout: '', stderr: 'dpkg error' } : NOT_FOUND),
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(
        adapter.install({
          app: CAST_APP,
          artifact: { kind: 'linux-deb', name: 'x.deb', url: 'https://x', sha512: 'x', size: 1 },
          artifactPath: '/tmp/x.deb',
          scope: 'system',
        }),
      ).rejects.toThrow(/dpkg error/);
    });

    it('refuses to install LumaCloud onto itself', async () => {
      const rig = createRig({ exec: () => NOT_FOUND });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(adapter.install(appImageRequest({ app: CLOUD_APP }))).rejects.toThrow(
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
          location: '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage',
          scope: 'user',
        },
        removeUserData: false,
        ...overrides,
      };
    }

    it('trashes an AppImage', async () => {
      const rig = createRig({
        dirs: ['/home/test/Applications'],
        files: { '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage': 'binary' },
        exec: () => NOT_FOUND,
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall());
      expect(rig.fs.trashed).toEqual(['/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage']);
    });

    it('removes a deb package with pkexec dpkg -r', async () => {
      const rig = createRig({ exec: () => OK });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await adapter.uninstall(
        baseUninstall({ installed: { app: 'cast', version: '1.2.3', location: '/opt/LumaCast', scope: 'system' } }),
      );
      const pkexecCall = rig.calls.find((call) => call.file === 'pkexec');
      expect(pkexecCall?.args).toEqual(['dpkg', '-r', 'lumacast']);
    });

    it('throws when pkexec dpkg -r fails', async () => {
      const rig = createRig({ exec: () => ({ code: 1, stdout: '', stderr: 'remove failed' }) });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(
        adapter.uninstall(
          baseUninstall({ installed: { app: 'cast', version: '1.2.3', location: '/opt/LumaCast', scope: 'system' } }),
        ),
      ).rejects.toThrow(/remove failed/);
    });

    it('removes user-data and updater-cache dirs when removeUserData is set', async () => {
      const rig = createRig({
        dirs: [
          '/home/test/Applications',
          '/home/test/.config/LumaCast',
          '/home/test/.cache/lumacast-updater',
        ],
        files: { '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage': 'binary' },
        exec: () => NOT_FOUND,
      });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall({ removeUserData: true }));
      expect(rig.fs.removed).toContain('/home/test/.config/LumaCast');
      expect(rig.fs.removed).toContain('/home/test/.cache/lumacast-updater');
    });

    it('refuses to uninstall LumaCloud from itself', async () => {
      const rig = createRig({ exec: () => NOT_FOUND });
      const adapter = createLinuxPlatformAdapter(rig.deps);
      await expect(
        adapter.uninstall(
          baseUninstall({
            app: CLOUD_APP,
            installed: { app: 'cloud', version: '0.1.0', location: '/opt/LumaCloud', scope: 'system' },
          }),
        ),
      ).rejects.toThrow('LumaCloud cannot install or remove itself');
    });
  });

  it('launch spawns an AppImage location detached', async () => {
    const spawnDetached = vi.fn().mockResolvedValue(undefined);
    const rig = createRig({ exec: () => NOT_FOUND, spawnDetached });
    const adapter = createLinuxPlatformAdapter(rig.deps);
    await adapter.launch(CAST_APP, {
      app: 'cast',
      version: '1.2.3',
      location: '/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage',
      scope: 'user',
    });
    expect(spawnDetached).toHaveBeenCalledWith('/home/test/Applications/LumaCast-1.2.3-x64-linux.AppImage', []);
  });

  it('launch spawns the /opt executable for a deb install', async () => {
    const spawnDetached = vi.fn().mockResolvedValue(undefined);
    const rig = createRig({ exec: () => NOT_FOUND, spawnDetached });
    const adapter = createLinuxPlatformAdapter(rig.deps);
    await adapter.launch(CAST_APP, { app: 'cast', version: '1.2.3', location: '/opt/LumaCast', scope: 'system' });
    expect(spawnDetached).toHaveBeenCalledWith('/opt/LumaCast/lumacast', []);
  });

  it('revealPath is the install location', () => {
    const rig = createRig({ exec: () => NOT_FOUND });
    const adapter = createLinuxPlatformAdapter(rig.deps);
    expect(adapter.revealPath({ app: 'cast', version: '1.2.3', location: '/opt/LumaCast', scope: 'system' })).toBe(
      '/opt/LumaCast',
    );
  });
});

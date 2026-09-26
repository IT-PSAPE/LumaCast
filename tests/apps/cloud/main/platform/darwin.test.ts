import { describe, expect, it } from 'vitest';
import type { ExecResult, InstallRequest, PlatformAdapterDeps, UninstallRequest } from '../../../../../apps/cloud/main/platform/adapter';
import { createDarwinPlatformAdapter, shellQuote } from '../../../../../apps/cloud/main/platform/darwin';
import {
  CAST_APP,
  CLOUD_APP,
  createFakeFs,
  createScriptedExec,
  darwinEnv,
  OK,
  type FakeFsState,
  type ScriptedExecCall,
} from './fixtures';

const CAST_PLIST = `<?xml version="1.0"?><plist><dict>
<key>CFBundleIdentifier</key><string>com.lumacast.app</string>
<key>CFBundleShortVersionString</key><string>1.2.3</string>
<key>CFBundleVersion</key><string>1.2.3</string>
</dict></plist>`;

const FOREIGN_PLIST = `<?xml version="1.0"?><plist><dict>
<key>CFBundleIdentifier</key><string>com.example.other</string>
<key>CFBundleShortVersionString</key><string>9.9.9</string>
</dict></plist>`;

interface Rig {
  deps: PlatformAdapterDeps;
  fs: FakeFsState;
  calls: ScriptedExecCall[];
}

function createRig(options: {
  files?: Record<string, string>;
  dirs?: string[];
  writableDirs?: string[];
  exec: (call: ScriptedExecCall) => ExecResult;
}): Rig {
  const fakeFs = createFakeFs({ files: options.files, dirs: options.dirs, writableDirs: options.writableDirs });
  const scripted = createScriptedExec(options.exec);
  return {
    deps: { env: darwinEnv(), fs: fakeFs.fs, exec: scripted.exec },
    fs: fakeFs.state,
    calls: scripted.calls,
  };
}

describe('darwin platform adapter', () => {
  it('installLocations: system is /Applications, user is ~/Applications', () => {
    const rig = createRig({ exec: () => OK });
    const adapter = createDarwinPlatformAdapter(rig.deps);
    expect(adapter.installLocations()).toEqual({
      system: '/Applications',
      user: '/Users/test/Applications',
    });
  });

  it('systemScopeWritable reads /Applications', async () => {
    const rig = createRig({ writableDirs: ['/Applications'], exec: () => OK });
    const adapter = createDarwinPlatformAdapter(rig.deps);
    await expect(adapter.systemScopeWritable()).resolves.toBe(true);
  });

  describe('discover', () => {
    it('finds the bundle in the user Applications dir first', async () => {
      const rig = createRig({
        files: { '/Users/test/Applications/LumaCast.app/Contents/Info.plist': CAST_PLIST },
        dirs: ['/Users/test/Applications/LumaCast.app'],
        exec: () => OK,
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toEqual({
        app: 'cast',
        version: '1.2.3',
        location: '/Users/test/Applications/LumaCast.app',
        scope: 'user',
      });
    });

    it('falls back to the system Applications dir', async () => {
      const rig = createRig({
        files: { '/Applications/LumaCast.app/Contents/Info.plist': CAST_PLIST },
        dirs: ['/Applications/LumaCast.app'],
        exec: () => OK,
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toMatchObject({ scope: 'system' });
    });

    it('rejects a foreign bundle sitting at the expected path and falls through to mdfind', async () => {
      const rig = createRig({
        files: {
          '/Users/test/Applications/LumaCast.app/Contents/Info.plist': FOREIGN_PLIST,
          '/Applications/LumaCast.app/Contents/Info.plist': FOREIGN_PLIST,
        },
        dirs: ['/Users/test/Applications/LumaCast.app', '/Applications/LumaCast.app'],
        exec: (call) => (call.file === 'mdfind' ? { code: 0, stdout: '', stderr: '' } : OK),
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toBeNull();
    });

    it('falls back to mdfind when neither well-known location has it', async () => {
      const rig = createRig({
        files: { '/Volumes/External/LumaCast.app/Contents/Info.plist': CAST_PLIST },
        dirs: ['/Volumes/External/LumaCast.app'],
        exec: (call) =>
          call.file === 'mdfind' ? { code: 0, stdout: '/Volumes/External/LumaCast.app\n', stderr: '' } : OK,
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toEqual({
        app: 'cast',
        version: '1.2.3',
        location: '/Volumes/External/LumaCast.app',
        scope: 'unknown',
      });
      const mdfindCall = rig.calls.find((call) => call.file === 'mdfind');
      expect(mdfindCall?.args).toEqual(['kMDItemCFBundleIdentifier == "com.lumacast.app"']);
    });

    it('returns null when nothing is found anywhere', async () => {
      const rig = createRig({ exec: () => ({ code: 1, stdout: '', stderr: '' }) });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(adapter.discover(CAST_APP)).resolves.toBeNull();
    });
  });

  describe('install', () => {
    function baseRequest(overrides: Partial<InstallRequest> = {}): InstallRequest {
      return {
        app: CAST_APP,
        artifact: { kind: 'mac-zip', name: 'LumaCast-1.2.3-arm64-mac.zip', url: 'https://x', sha512: 'x', size: 1 },
        artifactPath: '/Users/test/Library/Application Support/lumacloud/downloads/LumaCast-1.2.3-arm64-mac.zip',
        scope: 'user',
        ...overrides,
      };
    }

    it('extracts a zip with ditto, verifies the bundle id, and renames into place when writable', async () => {
      let stagingAppPath = '';
      const rig = createRig({
        writableDirs: ['/Users/test/Applications'],
        exec: (call) => {
          if (call.file === 'ditto' && call.args[0] === '-x') {
            const stagingDir = call.args[3];
            stagingAppPath = `${stagingDir}/LumaCast.app`;
            rig.fs.files.set(`${stagingAppPath}/Contents/Info.plist`, CAST_PLIST);
            rig.fs.dirs.add(stagingAppPath);
          }
          return OK;
        },
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      const stages: string[] = [];
      const installed = await adapter.install(baseRequest({ onStage: (s) => stages.push(s) }));

      expect(stages).toEqual(['extracting', 'placing']);
      expect(installed).toEqual({
        app: 'cast',
        version: '1.2.3',
        location: '/Users/test/Applications/LumaCast.app',
        scope: 'user',
      });
      expect(rig.fs.renamed).toEqual([{ from: stagingAppPath, to: '/Users/test/Applications/LumaCast.app' }]);
      const dittoCall = rig.calls.find((call) => call.file === 'ditto');
      expect(dittoCall?.args[0]).toBe('-x');
      expect(dittoCall?.args[1]).toBe('-k');
    });

    it('trashes an existing bundle before placing the new one', async () => {
      let stagingDir = '';
      const rig = createRig({
        writableDirs: ['/Users/test/Applications'],
        files: { '/Users/test/Applications/LumaCast.app/Contents/Info.plist': CAST_PLIST },
        dirs: ['/Users/test/Applications/LumaCast.app'],
        exec: (call) => {
          if (call.file === 'ditto' && call.args[0] === '-x') {
            stagingDir = call.args[3];
            rig.fs.files.set(`${stagingDir}/LumaCast.app/Contents/Info.plist`, CAST_PLIST);
            rig.fs.dirs.add(`${stagingDir}/LumaCast.app`);
          }
          return OK;
        },
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await adapter.install(baseRequest());
      expect(rig.fs.trashed).toEqual(['/Users/test/Applications/LumaCast.app']);
    });

    it('rejects a downloaded bundle whose Info.plist identifies as a different app', async () => {
      const rig = createRig({
        writableDirs: ['/Users/test/Applications'],
        exec: (call) => {
          if (call.file === 'ditto' && call.args[0] === '-x') {
            const stagingDir = call.args[3];
            rig.fs.files.set(`${stagingDir}/LumaCast.app/Contents/Info.plist`, FOREIGN_PLIST);
            rig.fs.dirs.add(`${stagingDir}/LumaCast.app`);
          }
          return OK;
        },
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(adapter.install(baseRequest())).rejects.toThrow(/expected com\.lumacast\.app/);
    });

    it('uses osascript with administrator privileges when the target is not writable', async () => {
      const rig = createRig({
        writableDirs: [],
        exec: (call) => {
          if (call.file === 'ditto' && call.args[0] === '-x') {
            const stagingDir = call.args[3];
            rig.fs.files.set(`${stagingDir}/LumaCast.app/Contents/Info.plist`, CAST_PLIST);
            rig.fs.dirs.add(`${stagingDir}/LumaCast.app`);
          }
          if (call.file === 'osascript') {
            // Installer script "succeeds": place the bundle so discover() finds it.
            rig.fs.files.set('/Applications/LumaCast.app/Contents/Info.plist', CAST_PLIST);
            rig.fs.dirs.add('/Applications/LumaCast.app');
          }
          return OK;
        },
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      const installed = await adapter.install(baseRequest({ scope: 'system' }));
      expect(installed.scope).toBe('system');

      const osascriptCall = rig.calls.find((call) => call.file === 'osascript');
      expect(osascriptCall).toBeDefined();
      expect(osascriptCall?.args[0]).toBe('-e');
      const script = osascriptCall!.args[1];
      expect(script).toContain('with administrator privileges');
      expect(script).toContain("rm -rf '/Applications/LumaCast.app'");
      expect(script).toContain("ditto '");
    });

    it('falls back to a ditto copy when rename fails across volumes (EXDEV)', async () => {
      let stagingAppPath = '';
      const rig = createRig({
        writableDirs: ['/Users/test/Applications'],
        exec: (call) => {
          if (call.file === 'ditto' && call.args[0] === '-x') {
            const stagingDir = call.args[3];
            stagingAppPath = `${stagingDir}/LumaCast.app`;
            rig.fs.files.set(`${stagingAppPath}/Contents/Info.plist`, CAST_PLIST);
            rig.fs.dirs.add(stagingAppPath);
            rig.fs.failRenameFrom.add(stagingAppPath);
          }
          if (call.file === 'ditto' && call.args.length === 2) {
            // The fallback copy call: ditto <staged> <target>.
            rig.fs.files.set('/Users/test/Applications/LumaCast.app/Contents/Info.plist', CAST_PLIST);
            rig.fs.dirs.add('/Users/test/Applications/LumaCast.app');
          }
          return OK;
        },
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      const installed = await adapter.install(baseRequest());
      expect(installed.location).toBe('/Users/test/Applications/LumaCast.app');
      expect(rig.fs.removed).toContain(stagingAppPath);
      const copyCall = rig.calls.find((call) => call.file === 'ditto' && call.args.length === 2);
      expect(copyCall?.args).toEqual([stagingAppPath, '/Users/test/Applications/LumaCast.app']);
    });

    it('refuses to install LumaCloud onto itself', async () => {
      const rig = createRig({ exec: () => OK });
      const adapter = createDarwinPlatformAdapter(rig.deps);
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
          location: '/Users/test/Applications/LumaCast.app',
          scope: 'user',
        },
        removeUserData: false,
        ...overrides,
      };
    }

    it('trashes the bundle when the containing dir is writable', async () => {
      const rig = createRig({
        writableDirs: ['/Users/test/Applications'],
        files: { '/Users/test/Applications/LumaCast.app/Contents/Info.plist': CAST_PLIST },
        dirs: ['/Users/test/Applications/LumaCast.app'],
        exec: () => OK,
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall());
      expect(rig.fs.trashed).toEqual(['/Users/test/Applications/LumaCast.app']);
    });

    it('uses an elevated rm -rf when the containing dir is not writable', async () => {
      const rig = createRig({ exec: () => OK });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await adapter.uninstall(
        baseUninstall({
          installed: { app: 'cast', version: '1.2.3', location: '/Applications/LumaCast.app', scope: 'system' },
        }),
      );
      const osascriptCall = rig.calls.find((call) => call.file === 'osascript');
      expect(osascriptCall?.args[1]).toContain(shellQuote('/Applications/LumaCast.app'));
      expect(osascriptCall?.args[1]).toContain('with administrator privileges');
    });

    it('removes user-data and updater-cache dirs when removeUserData is set', async () => {
      const rig = createRig({
        writableDirs: ['/Users/test/Applications'],
        files: {
          '/Users/test/Applications/LumaCast.app/Contents/Info.plist': CAST_PLIST,
          '/Users/test/Library/Application Support/LumaCast/settings.json': '{}',
          '/Users/test/Library/Caches/lumacast-updater/pending.yml': 'x',
        },
        dirs: [
          '/Users/test/Applications/LumaCast.app',
          '/Users/test/Library/Application Support/LumaCast',
          '/Users/test/Library/Caches/lumacast-updater',
        ],
        exec: () => OK,
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall({ removeUserData: true }));
      expect(rig.fs.removed).toContain('/Users/test/Library/Application Support/LumaCast');
      expect(rig.fs.removed).toContain('/Users/test/Library/Caches/lumacast-updater');
    });

    it('does not touch the updater cache dir when it does not exist', async () => {
      const rig = createRig({
        writableDirs: ['/Users/test/Applications'],
        files: { '/Users/test/Applications/LumaCast.app/Contents/Info.plist': CAST_PLIST },
        dirs: ['/Users/test/Applications/LumaCast.app'],
        exec: () => OK,
      });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await adapter.uninstall(baseUninstall({ removeUserData: true }));
      expect(rig.fs.removed).not.toContain('/Users/test/Library/Caches/lumacast-updater');
    });

    it('refuses to remove a bundle whose name does not match the app', async () => {
      const rig = createRig({ writableDirs: ['/Users/test/Applications'], exec: () => OK });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(
        adapter.uninstall(
          baseUninstall({
            installed: {
              app: 'cast',
              version: '1.2.3',
              location: '/Users/test/Applications/NotLumaCast.app',
              scope: 'user',
            },
          }),
        ),
      ).rejects.toThrow(/does not match/);
    });

    it('refuses to uninstall LumaCloud from itself', async () => {
      const rig = createRig({ exec: () => OK });
      const adapter = createDarwinPlatformAdapter(rig.deps);
      await expect(
        adapter.uninstall(
          baseUninstall({
            app: CLOUD_APP,
            installed: { app: 'cloud', version: '0.1.0', location: '/Applications/LumaCloud.app', scope: 'system' },
          }),
        ),
      ).rejects.toThrow('LumaCloud cannot install or remove itself');
    });
  });

  it('launch opens the bundle with `open -a`', async () => {
    const rig = createRig({ exec: () => OK });
    const adapter = createDarwinPlatformAdapter(rig.deps);
    await adapter.launch(CAST_APP, {
      app: 'cast',
      version: '1.2.3',
      location: '/Applications/LumaCast.app',
      scope: 'system',
    });
    expect(rig.calls).toEqual([{ file: 'open', args: ['-a', '/Applications/LumaCast.app'], options: undefined }]);
  });

  it('revealPath is the bundle location', () => {
    const rig = createRig({ exec: () => OK });
    const adapter = createDarwinPlatformAdapter(rig.deps);
    expect(
      adapter.revealPath({ app: 'cast', version: '1.2.3', location: '/Applications/LumaCast.app', scope: 'system' }),
    ).toBe('/Applications/LumaCast.app');
  });
});

describe('shellQuote', () => {
  it('wraps a value in single quotes', () => {
    expect(shellQuote('/Applications/LumaCast.app')).toBe("'/Applications/LumaCast.app'");
  });

  it('escapes an embedded single quote', () => {
    expect(shellQuote("it's/here.app")).toBe("'it'\\''s/here.app'");
  });
});

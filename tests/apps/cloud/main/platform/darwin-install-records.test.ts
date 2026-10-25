import { describe, expect, it } from 'vitest';
import type { InstallRequest, PlatformAdapterDeps } from '../../../../../apps/cloud/main/platform/adapter';
import { createDarwinPlatformAdapter } from '../../../../../apps/cloud/main/platform/darwin';
import { CAST_APP, createFakeFs, createScriptedExec, darwinEnv, OK, type ScriptedExecCall } from './fixtures';
import { createFakeRecords } from './records-fixture';

const plist = (id: string, version?: string) =>
  `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string>${
    version ? `<key>CFBundleShortVersionString</key><string>${version}</string>` : ''
  }</dict></plist>`;

const USER_BUNDLE = '/Users/test/Applications/LumaCast.app';
const SYSTEM_BUNDLE = '/Applications/LumaCast.app';
const PLIST_PATH = (bundle: string) => `${bundle}/Contents/Info.plist`;

function rig(options: {
  files?: Record<string, string>;
  dirs?: string[];
  records?: ReturnType<typeof createFakeRecords>;
  exec?: (call: ScriptedExecCall) => { code: number; stdout: string; stderr: string };
}) {
  const fakeFs = createFakeFs({ files: options.files, dirs: options.dirs, writableDirs: ['/Users/test/Applications'] });
  const scripted = createScriptedExec(options.exec ?? (() => OK));
  const records = options.records ?? createFakeRecords();
  const deps: PlatformAdapterDeps = { env: darwinEnv(), fs: fakeFs.fs, exec: scripted.exec, records };
  return { adapter: createDarwinPlatformAdapter(deps), calls: scripted.calls, records, fs: fakeFs.state };
}

describe('darwin discover with unreadable or partial bundle metadata', () => {
  it('reports a plist without a version as installed with an unknown version', async () => {
    const r = rig({ dirs: [USER_BUNDLE], files: { [PLIST_PATH(USER_BUNDLE)]: plist('com.lumacast.app') } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toMatchObject({ version: '', scope: 'user' });
  });

  it('still rejects a foreign bundle at the expected path', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.0.0', location: USER_BUNDLE, scope: 'user' }]);
    const r = rig({ records, dirs: [USER_BUNDLE], files: { [PLIST_PATH(USER_BUNDLE)]: plist('com.example.other', '9.9.9') } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toBeNull();
  });

  it('without a record, an unreadable Info.plist stays undiscovered (identity cannot be verified)', async () => {
    const r = rig({ dirs: [USER_BUNDLE] });
    await expect(r.adapter.discover(CAST_APP)).resolves.toBeNull();
  });

  it('with a record, an unreadable Info.plist still reports installed at the recorded version', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.2.3', location: USER_BUNDLE, scope: 'user' }]);
    const r = rig({ records, dirs: [USER_BUNDLE] });
    await expect(r.adapter.discover(CAST_APP)).resolves.toEqual({
      app: 'cast',
      version: '1.2.3',
      location: USER_BUNDLE,
      scope: 'user',
    });
  });
});

describe('darwin install records', () => {
  it('reuses a recorded custom location without calling mdfind', async () => {
    const custom = '/Volumes/Tools/LumaCast.app';
    const records = createFakeRecords([{ app: 'cast', version: '1.0.0', location: custom, scope: 'unknown' }]);
    const r = rig({ records, dirs: [custom], files: { [PLIST_PATH(custom)]: plist('com.lumacast.app', '1.4.0') } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toEqual({
      app: 'cast',
      version: '1.4.0',
      location: custom,
      scope: 'unknown',
    });
    expect(r.calls.filter((c) => c.file === 'mdfind')).toHaveLength(0);
  });

  it('honours a system-scope record', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.0.0', location: SYSTEM_BUNDLE, scope: 'system' }]);
    const r = rig({ records, dirs: [SYSTEM_BUNDLE], files: { [PLIST_PATH(SYSTEM_BUNDLE)]: plist('com.lumacast.app', '1.0.0') } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toMatchObject({ scope: 'system', location: SYSTEM_BUNDLE });
  });

  it('reports not-installed when the recorded bundle was deleted', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.0.0', location: USER_BUNDLE, scope: 'user' }]);
    const r = rig({ records });
    await expect(r.adapter.discover(CAST_APP)).resolves.toBeNull();
  });

  it('install records the resolved bundle; uninstall removes it', async () => {
    const staging = '/Users/test/Library/Application Support/lumacloud/downloads';
    const request: InstallRequest = {
      app: CAST_APP,
      artifact: { kind: 'mac-zip', name: 'x.zip', url: 'https://x', sha512: 'x', size: 1 },
      artifactPath: `${staging}/x.zip`,
      scope: 'user',
    };
    const r = rig({
      dirs: [staging, '/Users/test/Applications'],
      exec: (call) => {
        if (call.file === 'ditto') {
          // Simulate extraction: the staged bundle appears with its plist.
          const dest = call.args[3] as string;
          r.fs.dirs.add(`${dest}/LumaCast.app`);
          r.fs.files.set(PLIST_PATH(`${dest}/LumaCast.app`), plist('com.lumacast.app', '1.2.3'));
        }
        return OK;
      },
    });
    // After the rename, the fake fs moves the staged bundle to the target.
    const installed = await r.adapter.install(request);
    expect(installed).toMatchObject({ app: 'cast', scope: 'user', location: USER_BUNDLE });
    expect(r.records.get('cast', 'user')).toEqual(installed);

    await r.adapter.uninstall({ app: CAST_APP, installed, removeUserData: false });
    expect(r.records.get('cast', 'user')).toBeUndefined();
  });
});

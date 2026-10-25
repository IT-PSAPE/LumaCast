import { describe, expect, it } from 'vitest';
import type { ExecResult, InstallRequest, PlatformAdapterDeps } from '../../../../../apps/cloud/main/platform/adapter';
import { createWin32PlatformAdapter } from '../../../../../apps/cloud/main/platform/win32';
import { CAST_APP, createFakeFs, createScriptedExec, win32Env, type ScriptedExecCall } from './fixtures';
import { createFakeRecords } from './records-fixture';

const PROGRAMS = 'C:\\Users\\test\\AppData\\Local\\Programs';
const USER_DIR = `${PROGRAMS}\\LumaCast`;
const SYSTEM_DIR = 'C:\\Program Files\\LumaCast';
const OK: ExecResult = { code: 0, stdout: '', stderr: '' };
const isPowerShell = (call: ScriptedExecCall) => call.file === 'powershell';

function rig(options: {
  files?: Record<string, string>;
  dirs?: string[];
  records?: ReturnType<typeof createFakeRecords>;
  exec?: (call: ScriptedExecCall) => ExecResult;
}) {
  const fakeFs = createFakeFs({ files: options.files, dirs: options.dirs });
  const scripted = createScriptedExec(options.exec ?? (() => OK));
  const records = options.records ?? createFakeRecords();
  const deps: PlatformAdapterDeps = { env: win32Env(), fs: fakeFs.fs, exec: scripted.exec, records };
  return { adapter: createWin32PlatformAdapter(deps), fs: fakeFs.state, calls: scripted.calls, records };
}

describe('win32 discover without a version', () => {
  it('reports installed (version unknown) when the exe exists and PowerShell returns nothing', async () => {
    const r = rig({ dirs: [USER_DIR], files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toEqual({
      app: 'cast',
      version: '',
      location: USER_DIR,
      scope: 'user',
    });
  });

  it('reports installed when the version read times out (exec rejects)', async () => {
    const r = rig({
      dirs: [USER_DIR],
      files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' },
      exec: (call) => {
        if (isPowerShell(call)) throw new Error('timed out');
        return OK;
      },
    });
    await expect(r.adapter.discover(CAST_APP)).resolves.toMatchObject({ location: USER_DIR, version: '' });
  });

  it('gives PowerShell a 15s budget and reads the version at most once', async () => {
    const r = rig({ dirs: [USER_DIR], files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' } });
    await r.adapter.discover(CAST_APP);
    const ps = r.calls.filter(isPowerShell);
    expect(ps).toHaveLength(1);
    expect(ps[0].options?.timeoutMs).toBe(15_000);
  });

  it('reports an unknown version for a registry entry without a readable version', async () => {
    const r = rig({
      dirs: [USER_DIR],
      files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' },
      exec: (call) =>
        call.file === 'reg' && call.args[1]?.startsWith('HKCU')
          ? {
              code: 0,
              stdout: [
                'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\X',
                '    DisplayName    REG_SZ    LumaCast',
                `    InstallLocation    REG_SZ    ${USER_DIR}`,
                '',
              ].join('\r\n'),
              stderr: '',
            }
          : OK,
    });
    await expect(r.adapter.discover(CAST_APP)).resolves.toMatchObject({ version: '', scope: 'user' });
  });
});

describe('win32 install records', () => {
  it('reuses a recorded location without PowerShell or directory scans', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.2.3', location: 'D:\\Apps\\Cast', scope: 'user' }]);
    const r = rig({ records, dirs: ['D:\\Apps\\Cast'], files: { 'D:\\Apps\\Cast\\LumaCast.exe': 'bin' } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toEqual({
      app: 'cast',
      version: '1.2.3',
      location: 'D:\\Apps\\Cast',
      scope: 'user',
    });
    expect(r.calls.filter(isPowerShell)).toHaveLength(0);
  });

  it('reports not-installed when the recorded binary was deleted', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.2.3', location: USER_DIR, scope: 'user' }]);
    const r = rig({ records });
    await expect(r.adapter.discover(CAST_APP)).resolves.toBeNull();
  });

  it('falls through to probing when the recorded binary is gone but another copy exists', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.2.3', location: 'D:\\Gone', scope: 'user' }]);
    const r = rig({ records, dirs: [USER_DIR], files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toMatchObject({ location: USER_DIR });
  });

  it('honours a system-scope record', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '2.0.0', location: SYSTEM_DIR, scope: 'system' }]);
    const r = rig({ records, files: { [`${SYSTEM_DIR}\\LumaCast.exe`]: 'bin' } });
    await expect(r.adapter.discover(CAST_APP)).resolves.toEqual({
      app: 'cast',
      version: '2.0.0',
      location: SYSTEM_DIR,
      scope: 'system',
    });
  });

  it('keeps records per app: another app’s record is ignored', async () => {
    const records = createFakeRecords([{ app: 'flux', version: '1.0.0', location: USER_DIR, scope: 'user' }]);
    const r = rig({ records, files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' } });
    // No cast record and no registry entry: only the probe path can find it.
    await expect(r.adapter.discover(CAST_APP)).resolves.toMatchObject({ version: '' });
    expect(r.calls.some(isPowerShell)).toBe(true);
  });

  it('refreshes the version from the registry DisplayVersion after an in-app update', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.0.0', location: USER_DIR, scope: 'user' }]);
    const r = rig({
      records,
      files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' },
      exec: (call) =>
        call.file === 'reg' && call.args[1]?.startsWith('HKCU')
          ? {
              code: 0,
              stdout: [
                'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\X',
                '    DisplayName    REG_SZ    LumaCast 1.1.0',
                '    DisplayVersion    REG_SZ    1.1.0',
                '',
              ].join('\r\n'),
              stderr: '',
            }
          : OK,
    });
    await expect(r.adapter.discover(CAST_APP)).resolves.toMatchObject({ version: '1.1.0', location: USER_DIR });
    expect(r.calls.some(isPowerShell)).toBe(false);
  });

  it('install records the resolved location and version, replacing any older record', async () => {
    const request: InstallRequest = {
      app: CAST_APP,
      artifact: { kind: 'win-nsis', name: 'x.exe', url: 'https://x', sha512: 'x', size: 1 },
      artifactPath: 'C:\\dl\\x.exe',
      scope: 'user',
    };
    const records = createFakeRecords([{ app: 'cast', version: '0.1.0', location: 'D:\\Old', scope: 'user' }]);
    const r = rig({
      records,
      dirs: [USER_DIR],
      files: { [`${USER_DIR}\\LumaCast.exe`]: 'bin' },
      exec: (call) => (isPowerShell(call) ? { code: 0, stdout: '1.2.3\r\n', stderr: '' } : OK),
    });
    const installed = await r.adapter.install(request);
    expect(installed).toMatchObject({ version: '1.2.3', location: USER_DIR });
    expect(r.records.get('cast', 'user')).toEqual(installed);
  });

  it('uninstall removes the record for that scope', async () => {
    const records = createFakeRecords([{ app: 'cast', version: '1.0.0', location: USER_DIR, scope: 'user' }]);
    const r = rig({
      records,
      exec: (call) =>
        call.file === 'reg'
          ? {
              code: 0,
              stdout: [
                'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\X',
                '    DisplayName    REG_SZ    LumaCast',
                '    QuietUninstallString    REG_SZ    "C:\\u\\Uninstall.exe" /S',
                '',
              ].join('\r\n'),
              stderr: '',
            }
          : OK,
    });
    await r.adapter.uninstall({
      app: CAST_APP,
      installed: { app: 'cast', version: '1.0.0', location: USER_DIR, scope: 'user' },
      removeUserData: false,
    });
    expect(r.records.get('cast', 'user')).toBeUndefined();
  });
});

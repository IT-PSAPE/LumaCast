import { describe, expect, it } from 'vitest';
import { parseRegQueryOutput } from '../../../../../apps/cloud/main/platform/win32-registry';

describe('parseRegQueryOutput', () => {
  it('parses one uninstall entry into a key and its values', () => {
    const stdout = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LumaCast',
      '    DisplayName    REG_SZ    LumaCast',
      '    DisplayVersion    REG_SZ    1.2.3',
      '    InstallLocation    REG_SZ    C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
      '    UninstallString    REG_SZ    C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\Uninstall LumaCast.exe',
      '    QuietUninstallString    REG_SZ    C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\Uninstall LumaCast.exe /S',
      '',
    ].join('\r\n');

    const entries = parseRegQueryOutput(stdout);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe(
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LumaCast',
    );
    expect(entries[0].values).toEqual({
      DisplayName: 'LumaCast',
      DisplayVersion: '1.2.3',
      InstallLocation: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast',
      UninstallString: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\Uninstall LumaCast.exe',
      QuietUninstallString: 'C:\\Users\\test\\AppData\\Local\\Programs\\LumaCast\\Uninstall LumaCast.exe /S',
    });
  });

  it('parses multiple entries separated by blank lines', () => {
    const stdout = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID-1}',
      '    DisplayName    REG_SZ    Some Other App',
      '    DisplayVersion    REG_SZ    9.9.9',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LumaCloud',
      '    DisplayName    REG_SZ    LumaCloud',
      '    DisplayVersion    REG_SZ    0.1.0',
      '',
    ].join('\r\n');

    const entries = parseRegQueryOutput(stdout);
    expect(entries.map((entry) => entry.values.DisplayName)).toEqual(['Some Other App', 'LumaCloud']);
  });

  it('keeps a value with embedded spaces intact (only splits the first two fields)', () => {
    const stdout = [
      'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LumaCast',
      '    UninstallString    REG_SZ    "C:\\Program Files\\LumaCast\\Uninstall LumaCast.exe"',
    ].join('\r\n');

    const entries = parseRegQueryOutput(stdout);
    expect(entries[0].values.UninstallString).toBe('"C:\\Program Files\\LumaCast\\Uninstall LumaCast.exe"');
  });

  it('handles \\n-only line endings', () => {
    const stdout = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LumaCast',
      '    DisplayName    REG_SZ    LumaCast',
    ].join('\n');

    expect(parseRegQueryOutput(stdout)[0].values.DisplayName).toBe('LumaCast');
  });

  it('returns no entries for empty or error output', () => {
    expect(parseRegQueryOutput('')).toEqual([]);
    expect(
      parseRegQueryOutput('ERROR: The system was unable to find the specified registry key or value.\r\n'),
    ).toEqual([]);
  });

  it('ignores a value line with no key header yet', () => {
    const stdout = '    DisplayName    REG_SZ    Orphan\r\n';
    expect(parseRegQueryOutput(stdout)).toEqual([]);
  });
});

// Parses the plain-text output of `reg query <key> /s`, e.g.:
//
//   HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\LumaCast
//       DisplayName    REG_SZ    LumaCast
//       DisplayVersion    REG_SZ    1.2.3
//       InstallLocation    REG_SZ    C:\Users\x\AppData\Local\Programs\LumaCast
//       UninstallString    REG_SZ    C:\Users\x\...\Uninstall LumaCast.exe
//       QuietUninstallString    REG_SZ    C:\Users\x\...\Uninstall LumaCast.exe /S
//
// A key header line starts at column 0; every indented line under it is one
// value, `name`, `REG_TYPE`, and a value that may itself contain spaces (a
// path), so only the first two fields are split on whitespace and the rest
// of the line is kept verbatim as the value.

export interface RegQueryEntry {
  key: string;
  values: Record<string, string>;
}

const VALUE_LINE = /^\s+(\S+)\s+(REG_[A-Z_]+)\s+(.*)$/;

export function parseRegQueryOutput(stdout: string): RegQueryEntry[] {
  const entries: RegQueryEntry[] = [];
  let current: RegQueryEntry | null = null;

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) {
      continue;
    }
    if (!/^\s/.test(rawLine)) {
      // A key header line (no leading whitespace) starts a new entry. Only
      // an actual key path is recognized as one — reg.exe also prints
      // unindented lines that are not a key header (e.g. "ERROR: The system
      // was unable to find the specified registry key or value." when the
      // key doesn't exist), and those must not swallow the values that would
      // otherwise follow.
      current = rawLine.startsWith('HKEY_') ? { key: rawLine.trim(), values: {} } : null;
      if (current) {
        entries.push(current);
      }
      continue;
    }
    if (current === null) {
      continue;
    }
    const match = VALUE_LINE.exec(rawLine);
    if (match !== null) {
      const [, name, , value] = match;
      current.values[name] = value;
    }
  }

  return entries;
}

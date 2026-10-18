// Windows' character and device-name rules are the strictest of the supported platforms, so
// one portable rule set keeps recordings copyable between macOS and Windows machines.
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const SUPPORTED_TOKENS = ['%CCYY', '%MM', '%DD', '%hh', '%mm', '%ss'] as const;

export function validateRecordingFilenameFormat(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 120 || value.trim().length === 0
    || INVALID_FILENAME_CHARACTERS.test(value) || /[. ]$/.test(value)) return false;
  const remainder = SUPPORTED_TOKENS.reduce((format, token) => format.replaceAll(token, ''), value);
  if (remainder.includes('%')) return false;
  const stem = value.split('.')[0]?.toUpperCase() ?? '';
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

export function formatRecordingFilenameBase(format: string, at: Date): string {
  if (!validateRecordingFilenameFormat(format)) throw new Error('Recording filename format is invalid.');
  const values: Record<(typeof SUPPORTED_TOKENS)[number], string> = {
    '%CCYY': String(at.getFullYear()).padStart(4, '0'),
    '%MM': String(at.getMonth() + 1).padStart(2, '0'),
    '%DD': String(at.getDate()).padStart(2, '0'),
    '%hh': String(at.getHours()).padStart(2, '0'),
    '%mm': String(at.getMinutes()).padStart(2, '0'),
    '%ss': String(at.getSeconds()).padStart(2, '0'),
  };
  const result = SUPPORTED_TOKENS.reduce((name, token) => name.replaceAll(token, values[token]), format);
  if (result.trim().length === 0 || INVALID_FILENAME_CHARACTERS.test(result) || /[. ]$/.test(result)) {
    throw new Error('Recording filename format produced an invalid filename.');
  }
  const stem = result.split('.')[0]?.toUpperCase() ?? '';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) throw new Error('Recording filename format produced a reserved filename.');
  const baseName = result.replace(/\.(webm|mkv|mp4)$/i, '');
  if (baseName.trim().length === 0 || /[. ]$/.test(baseName)) throw new Error('Recording filename format produced an invalid filename.');
  return baseName;
}

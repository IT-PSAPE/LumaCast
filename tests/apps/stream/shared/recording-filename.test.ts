import { describe, expect, it } from 'vitest';
import { formatRecordingFilenameBase, validateRecordingFilenameFormat } from '../../../../apps/stream/shared/recording-filename';

describe('Stream recording filename formats', () => {
  it('expands OBS-style date and time tokens using local time', () => {
    const at = new Date(2026, 9, 17, 9, 4, 6);
    expect(formatRecordingFilenameBase('LumaStream %CCYY-%MM-%DD %hh-%mm-%ss', at))
      .toBe('LumaStream 2026-10-17 09-04-06');
  });

  it('removes a known video extension before the selected output format is added', () => {
    expect(formatRecordingFilenameBase('Capture.mp4', new Date(2026, 0, 1))).toBe('Capture');
  });

  it.each(['', ' ', 'Invalid/name', 'Invalid\\name', 'CON', 'LPT1.log', '%unknown', 'trailing.'])('rejects unsafe or malformed formats: %s', (format) => {
    expect(validateRecordingFilenameFormat(format)).toBe(false);
    expect(() => formatRecordingFilenameBase(format, new Date(2026, 0, 1))).toThrow('invalid');
  });

  it('allows a device-name prefix when a token makes the final name unique', () => {
    expect(formatRecordingFilenameBase('NUL-%MM', new Date(2026, 0, 1))).toBe('NUL-01');
  });
});

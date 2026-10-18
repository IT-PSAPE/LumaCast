import { describe, expect, it } from 'vitest';
import { createDefaultProject, createDefaultTextStyle } from '../../../../apps/stream/shared/desktop-api';
import { defaultTextFontFamilyForPlatform, defaultVideoEncoderForPlatform } from '../../../../apps/stream/shared/platform-capabilities';

describe('Stream default project encoder selection per platform', () => {
  it('defaults to Media Foundation on Windows', () => {
    const project = createDefaultProject('win32');
    expect(project.output.streamVideoEncoder).toBe(defaultVideoEncoderForPlatform('win32'));
    expect(project.output.streamVideoEncoder).toBe('h264_mf');
    expect(project.output.recordingVideoEncoder).toBe('h264_mf');
  });

  it('defaults to VideoToolbox on macOS', () => {
    const project = createDefaultProject('darwin');
    expect(project.output.streamVideoEncoder).toBe(defaultVideoEncoderForPlatform('darwin'));
    expect(project.output.streamVideoEncoder).toBe('h264_videotoolbox');
    expect(project.output.recordingVideoEncoder).toBe('h264_videotoolbox');
  });

  it('defaults to win32 when no platform is given', () => {
    const project = createDefaultProject();
    expect(project.output.streamVideoEncoder).toBe('h264_mf');
    expect(project.output.recordingVideoEncoder).toBe('h264_mf');
  });
});

describe('Stream default text style font selection per platform', () => {
  it('defaults to Segoe UI on Windows', () => {
    const style = createDefaultTextStyle('win32');
    expect(style.fontFamily).toBe(defaultTextFontFamilyForPlatform('win32'));
    expect(style.fontFamily).toBe('Segoe UI');
  });

  it('defaults to Helvetica Neue on macOS', () => {
    const style = createDefaultTextStyle('darwin');
    expect(style.fontFamily).toBe(defaultTextFontFamilyForPlatform('darwin'));
    expect(style.fontFamily).toBe('Helvetica Neue');
  });

  it('defaults to win32 when no platform is given', () => {
    expect(createDefaultTextStyle().fontFamily).toBe('Segoe UI');
  });
});

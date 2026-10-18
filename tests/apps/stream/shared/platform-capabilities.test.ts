import { describe, expect, it } from 'vitest';
import {
  applicationAudioHelperFilename,
  defaultTextFontFamilyForPlatform,
  defaultVideoEncoderForPlatform,
  desktopAudioCaptureModeForPlatform,
  hardwareEncodingLabelForPlatform,
  isVideoEncoderAvailableOnPlatform,
  mediaEngineExecutableName,
  primaryShortcutLabel,
  supportsApplicationAudioCapture,
  supportsDisplayCaptureSystemAudio,
  systemVideoEncoderForPlatform,
  textFontFamiliesForPlatform,
  toStreamPlatform,
  videoEncoderFamiliesForPlatform,
  type StreamPlatform,
} from '../../../../apps/stream/shared/platform-capabilities';

const PLATFORMS: StreamPlatform[] = ['win32', 'darwin', 'linux'];

describe('Stream platform normalization', () => {
  it('passes through the two supported platforms', () => {
    expect(toStreamPlatform('win32')).toBe('win32');
    expect(toStreamPlatform('darwin')).toBe('darwin');
  });

  it.each(['linux', 'freebsd', 'android', ''])('maps unknown platform strings to linux (%s)', (value) => {
    expect(toStreamPlatform(value)).toBe('linux');
  });
});

describe('Stream video encoder families per platform', () => {
  it('offers five Windows encoder families defaulting to Media Foundation', () => {
    const families = videoEncoderFamiliesForPlatform('win32');
    expect(families).toHaveLength(5);
    expect(families).toEqual(['h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libopenh264']);
    expect(defaultVideoEncoderForPlatform('win32')).toBe('h264_mf');
  });

  it('offers only VideoToolbox on macOS', () => {
    const families = videoEncoderFamiliesForPlatform('darwin');
    expect(families).toEqual(['h264_videotoolbox']);
    expect(defaultVideoEncoderForPlatform('darwin')).toBe('h264_videotoolbox');
  });

  it('offers only the OpenH264 software encoder on Linux', () => {
    const families = videoEncoderFamiliesForPlatform('linux');
    expect(families).toEqual(['libopenh264']);
    expect(defaultVideoEncoderForPlatform('linux')).toBe('libopenh264');
  });

  it('reports encoder availability per platform', () => {
    expect(isVideoEncoderAvailableOnPlatform('win32', 'h264_nvenc')).toBe(true);
    expect(isVideoEncoderAvailableOnPlatform('win32', 'h264_videotoolbox')).toBe(false);
    expect(isVideoEncoderAvailableOnPlatform('darwin', 'h264_videotoolbox')).toBe(true);
    expect(isVideoEncoderAvailableOnPlatform('darwin', 'h264_mf')).toBe(false);
    expect(isVideoEncoderAvailableOnPlatform('linux', 'libopenh264')).toBe(true);
    expect(isVideoEncoderAvailableOnPlatform('linux', 'h264_nvenc')).toBe(false);
  });

  it('names the OS-honored hardware encoder family, or none on Linux', () => {
    expect(systemVideoEncoderForPlatform('win32')).toBe('h264_mf');
    expect(systemVideoEncoderForPlatform('darwin')).toBe('h264_videotoolbox');
    expect(systemVideoEncoderForPlatform('linux')).toBeNull();
  });

  it('labels the hardware-encoding toggle per platform', () => {
    expect(hardwareEncodingLabelForPlatform('darwin')).toBe('Require VideoToolbox hardware encoding');
    expect(hardwareEncodingLabelForPlatform('win32')).toBe('Use Media Foundation hardware encoding');
    expect(hardwareEncodingLabelForPlatform('linux')).toBe('Use Media Foundation hardware encoding');
  });
});

describe('Stream desktop and application audio capture modes', () => {
  it('maps each platform to its desktop audio capture mode', () => {
    expect(desktopAudioCaptureModeForPlatform('win32')).toBe('display-loopback');
    expect(desktopAudioCaptureModeForPlatform('darwin')).toBe('system-tap');
    expect(desktopAudioCaptureModeForPlatform('linux')).toBe('unavailable');
  });

  it('only Windows carries system audio on a display/window capture', () => {
    expect(supportsDisplayCaptureSystemAudio('win32')).toBe(true);
    expect(supportsDisplayCaptureSystemAudio('darwin')).toBe(false);
    expect(supportsDisplayCaptureSystemAudio('linux')).toBe(false);
  });

  it('application audio capture is supported on Windows and macOS only', () => {
    expect(supportsApplicationAudioCapture('win32')).toBe(true);
    expect(supportsApplicationAudioCapture('darwin')).toBe(true);
    expect(supportsApplicationAudioCapture('linux')).toBe(false);
  });

  it('names the application-audio helper binary per platform, or null where unsupported', () => {
    expect(applicationAudioHelperFilename('win32')).toBe('AudioLoopback.exe');
    expect(applicationAudioHelperFilename('darwin')).toBe('lumastream-audio-tap');
    expect(applicationAudioHelperFilename('linux')).toBeNull();
  });
});

describe('Stream media engine executable naming', () => {
  it('appends .exe only on Windows', () => {
    expect(mediaEngineExecutableName('win32')).toBe('ffmpeg.exe');
    expect(mediaEngineExecutableName('darwin')).toBe('ffmpeg');
    expect(mediaEngineExecutableName('linux')).toBe('ffmpeg');
  });
});

describe('Stream text overlay font families per platform', () => {
  it.each(PLATFORMS)('defaults to the first font family in the platform list (%s)', (platform) => {
    const families = textFontFamiliesForPlatform(platform);
    expect(families.length).toBeGreaterThan(0);
    expect(defaultTextFontFamilyForPlatform(platform)).toBe(families[0]);
  });

  it('uses Segoe UI on Windows and Helvetica Neue on macOS', () => {
    expect(defaultTextFontFamilyForPlatform('win32')).toBe('Segoe UI');
    expect(defaultTextFontFamilyForPlatform('darwin')).toBe('Helvetica Neue');
  });
});

describe('Stream primary shortcut labels', () => {
  it('renders macOS chords with the command glyph', () => {
    expect(primaryShortcutLabel('darwin', 'Z')).toBe('⌘Z');
    expect(primaryShortcutLabel('darwin', 'Z', true)).toBe('⇧⌘Z');
  });

  it('renders Windows and Linux chords as Ctrl text', () => {
    expect(primaryShortcutLabel('win32', 'Z')).toBe('Ctrl+Z');
    expect(primaryShortcutLabel('win32', 'Z', true)).toBe('Ctrl+Shift+Z');
    expect(primaryShortcutLabel('linux', 'Z', true)).toBe('Ctrl+Shift+Z');
  });
});

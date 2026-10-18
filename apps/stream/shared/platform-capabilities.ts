import type { VideoEncoderFamily } from './desktop-api';

export type StreamPlatform = 'win32' | 'darwin' | 'linux';

export function toStreamPlatform(value: string): StreamPlatform {
  return value === 'win32' || value === 'darwin' ? value : 'linux';
}

const PLATFORM_VIDEO_ENCODERS: Record<StreamPlatform, readonly VideoEncoderFamily[]> = {
  win32: ['h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libopenh264'],
  // VideoToolbox falls back to Apple's software encoder on its own, so macOS needs no separate software family.
  darwin: ['h264_videotoolbox'],
  linux: ['libopenh264'],
};

export function videoEncoderFamiliesForPlatform(platform: StreamPlatform): readonly VideoEncoderFamily[] {
  return PLATFORM_VIDEO_ENCODERS[platform];
}

export function defaultVideoEncoderForPlatform(platform: StreamPlatform): VideoEncoderFamily {
  return PLATFORM_VIDEO_ENCODERS[platform][0]!;
}

export function isVideoEncoderAvailableOnPlatform(platform: StreamPlatform, encoder: VideoEncoderFamily): boolean {
  return PLATFORM_VIDEO_ENCODERS[platform].includes(encoder);
}

/** The encoder family whose hardware-encoding toggle the OS honors (Media Foundation or VideoToolbox). */
export function systemVideoEncoderForPlatform(platform: StreamPlatform): VideoEncoderFamily | null {
  return platform === 'win32' ? 'h264_mf' : platform === 'darwin' ? 'h264_videotoolbox' : null;
}

export function hardwareEncodingLabelForPlatform(platform: StreamPlatform): string {
  return platform === 'darwin' ? 'Require VideoToolbox hardware encoding' : 'Use Media Foundation hardware encoding';
}

/**
 * How "Audio Output Capture" reaches the system mix. Windows attaches Electron's
 * loopback track to a display capture; macOS uses a Core Audio process tap served
 * by the application-audio helper; other platforms have no supported route.
 */
export type DesktopAudioCaptureMode = 'display-loopback' | 'system-tap' | 'unavailable';

export function desktopAudioCaptureModeForPlatform(platform: StreamPlatform): DesktopAudioCaptureMode {
  return platform === 'win32' ? 'display-loopback' : platform === 'darwin' ? 'system-tap' : 'unavailable';
}

/** Whether a display or window capture can carry the system audio mix on the same stream. */
export function supportsDisplayCaptureSystemAudio(platform: StreamPlatform): boolean {
  return desktopAudioCaptureModeForPlatform(platform) === 'display-loopback';
}

export function supportsApplicationAudioCapture(platform: StreamPlatform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

export function applicationAudioHelperFilename(platform: StreamPlatform): string | null {
  return platform === 'win32' ? 'AudioLoopback.exe' : platform === 'darwin' ? 'lumastream-audio-tap' : null;
}

export function mediaEngineExecutableName(platform: StreamPlatform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

const PLATFORM_TEXT_FONTS: Record<StreamPlatform, readonly string[]> = {
  win32: ['Segoe UI', 'Arial', 'Arial Black', 'Calibri', 'Consolas', 'Georgia', 'Impact', 'Tahoma', 'Verdana'],
  darwin: ['Helvetica Neue', 'Arial', 'Arial Black', 'Avenir Next', 'Georgia', 'Impact', 'Menlo', 'SF Pro', 'Verdana'],
  linux: ['DejaVu Sans', 'Arial', 'Georgia', 'Liberation Sans', 'Noto Sans', 'Verdana'],
};

export function textFontFamiliesForPlatform(platform: StreamPlatform): readonly string[] {
  return PLATFORM_TEXT_FONTS[platform];
}

export function defaultTextFontFamilyForPlatform(platform: StreamPlatform): string {
  return PLATFORM_TEXT_FONTS[platform][0]!;
}

/** Human-readable shortcut for a primary-modifier chord such as undo. */
export function primaryShortcutLabel(platform: StreamPlatform, key: string, shift = false): string {
  if (platform === 'darwin') return `${shift ? '⇧' : ''}⌘${key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

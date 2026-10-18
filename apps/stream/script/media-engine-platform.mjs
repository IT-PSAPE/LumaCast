/**
 * Describes where the Stream media engine (FFmpeg) comes from on each host.
 *
 * Windows x64 downloads a pinned LGPL shared build. macOS has no public LGPL
 * build that also carries the SRT and RIST outputs Stream requires, so the macOS
 * engine is supplied explicitly: `LUMASTREAM_MEDIA_ENGINE` names a static LGPL
 * `ffmpeg` to copy into the vendor tree, or, for local development only, the
 * `ffmpeg` on PATH is linked in place and checked for the required features.
 */

export const REQUIRED_OUTPUT_PROTOCOLS = ['rist', 'srt'];

const WINDOWS_BUNDLE = {
  version: '9.0.2-28-g669f5ab083',
  url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-16-13-04/ffmpeg-n9.0.2-28-g669f5ab083-win64-lgpl-shared-9.0.zip',
  sha256: '337bccf4f9ed8594255572907d0c3c19e673894713d63d92664d846c4ad183c8',
  buildTag: 'autobuild-2026-10-16-13-04',
  buildRepository: 'https://github.com/BtbN/FFmpeg-Builds',
};

export function assertRequiredOutputProtocols(protocolsOutput) {
  const outputSection = protocolsOutput.match(/^Output:[ \t]*\r?\n([\s\S]*)$/m)?.[1];
  if (!outputSection) {
    throw new Error('The Stream media engine did not report its output protocols.');
  }

  const available = new Set(outputSection.split(/\r?\n/).map((line) => line.trim()));
  const missing = REQUIRED_OUTPUT_PROTOCOLS.filter((protocol) => !available.has(protocol));
  if (missing.length > 0) {
    throw new Error(`The Stream media engine is missing required output protocols: ${missing.join(', ')}.`);
  }
}

/** Encoder names the engine must expose on a platform, matching the families Stream offers there. */
export function requiredEncodersForPlatform(platform) {
  if (platform === 'win32') return ['h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libopenh264', 'aac'];
  if (platform === 'darwin') return ['h264_videotoolbox', 'aac'];
  return ['libopenh264', 'aac'];
}

export function assertRequiredEncoders(encodersOutput, platform) {
  const missing = requiredEncodersForPlatform(platform).filter((name) => !new RegExp(`\\b${name}\\b`).test(encodersOutput));
  if (missing.length > 0) {
    throw new Error(`The Stream media engine is missing required encoders for ${platform}: ${missing.join(', ')}.`);
  }
}

export function mediaEngineExecutableName(platform) {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

/**
 * Decides how to prepare the engine for a host.
 *
 * @param {{ platform: string; arch: string; env: Record<string, string | undefined>; development: boolean }} host
 * @returns {{ kind: 'download'; bundle: typeof WINDOWS_BUNDLE } | { kind: 'explicit'; executable: string } | { kind: 'path'; command: string } | { kind: 'unsupported'; reason: string }}
 */
export function resolveMediaEngineSource(host) {
  if (host.platform === 'win32') {
    if (host.arch !== 'x64') return { kind: 'unsupported', reason: 'The bundled Windows media engine supports x64 only.' };
    return { kind: 'download', bundle: WINDOWS_BUNDLE };
  }
  const explicit = host.env.LUMASTREAM_MEDIA_ENGINE?.trim();
  if (explicit) return { kind: 'explicit', executable: explicit };
  if (host.platform === 'darwin') {
    if (host.development) return { kind: 'path', command: 'ffmpeg' };
    return {
      kind: 'unsupported',
      reason: 'No redistributable macOS media engine is configured. Set LUMASTREAM_MEDIA_ENGINE to a static LGPL FFmpeg built with --enable-libsrt --enable-librist and VideoToolbox, or run `npm run dev` to use the ffmpeg on PATH for development.',
    };
  }
  return { kind: 'unsupported', reason: `The Stream media engine is not supported on ${host.platform}.` };
}

/** Parses `ffmpeg -version` configuration flags into licensing facts. */
export function inspectBuildConfiguration(versionOutput) {
  return {
    gpl: /--enable-gpl\b|--enable-nonfree\b/.test(versionOutput),
    shared: /--enable-shared\b/.test(versionOutput) && !/--disable-shared\b/.test(versionOutput),
    static: /--disable-shared\b/.test(versionOutput) || /--enable-static\b/.test(versionOutput),
  };
}

/** Checks that `otool -L` output references only system libraries, so the binary runs on any Mac. */
export function assertSelfContainedMachO(otoolOutput) {
  const external = otoolOutput.split(/\r?\n/).slice(1)
    .map((line) => line.trim().split(' (')[0])
    .filter((entry) => entry && !entry.startsWith('/usr/lib/') && !entry.startsWith('/System/Library/'));
  if (external.length > 0) {
    throw new Error(`The macOS media engine links non-system libraries and cannot be redistributed as-is: ${external.join(', ')}.`);
  }
}

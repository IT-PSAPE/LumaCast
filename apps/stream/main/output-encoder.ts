import { isVideoEncoderFamily, supportsVideoRateControl, type RecordingOutputSettings, type StreamOutputSettings, type VideoEncoderFamily, type VideoRateControlMode } from '../shared/desktop-api';

interface EncoderArguments {
  frameRate: number;
  videoBitrateKbps: number;
  rateControl: VideoRateControlMode;
  encoder: VideoEncoderFamily;
  encoderQuality: number;
  hardwareEncoding: boolean;
  keyframeIntervalSeconds: number;
  scenario: 'live_streaming' | 'archive';
  width?: number;
  height?: number;
}

function validateEncoderArguments(settings: EncoderArguments): void {
  if (!Number.isInteger(settings.frameRate) || settings.frameRate < 15 || settings.frameRate > 60
    || !Number.isInteger(settings.videoBitrateKbps) || settings.videoBitrateKbps < 250 || settings.videoBitrateKbps > 50000
    || !isVideoEncoderFamily(settings.encoder)
    || !supportsVideoRateControl(settings.encoder, settings.rateControl)
    || !Number.isInteger(settings.encoderQuality) || settings.encoderQuality < 0 || settings.encoderQuality > 100
    || typeof settings.hardwareEncoding !== 'boolean'
    || !Number.isInteger(settings.keyframeIntervalSeconds) || settings.keyframeIntervalSeconds < 1 || settings.keyframeIntervalSeconds > 10) {
    throw new Error('The video encoder settings are outside the supported range.');
  }
}

function qualityQuantizer(quality: number): number {
  return Math.max(1, 51 - Math.round(quality * 0.5));
}

function appendBitrateArguments(args: string[], settings: EncoderArguments): void {
  if (settings.rateControl === 'quality') return;
  const bitrate = `${settings.videoBitrateKbps}k`;
  args.push('-b:v', bitrate);
  if (settings.rateControl === 'cbr') {
    args.push('-maxrate', bitrate, '-bufsize', `${settings.videoBitrateKbps * 2}k`);
  } else if (settings.rateControl === 'pc_vbr') {
    const maximumBitrate = Math.ceil(settings.videoBitrateKbps * 1.5);
    args.push('-maxrate', `${maximumBitrate}k`, '-bufsize', `${maximumBitrate * 2}k`);
  }
}

function mediaFoundationArguments(settings: EncoderArguments): string[] {
  const args = [
    '-c:v', 'h264_mf',
    '-scenario', settings.scenario,
    '-rate_control', settings.rateControl,
    '-quality', String(settings.encoderQuality),
    '-hw_encoding', settings.hardwareEncoding ? '1' : '0',
  ];
  appendBitrateArguments(args, settings);
  return args;
}

function nvencArguments(settings: EncoderArguments): string[] {
  const preset = Math.min(7, Math.max(1, Math.round(1 + settings.encoderQuality * 0.06)));
  const args = [
    '-c:v', 'h264_nvenc',
    '-preset', `p${preset}`,
    '-tune', settings.scenario === 'live_streaming' ? 'ull' : 'hq',
    '-rc', settings.rateControl === 'cbr' ? 'cbr' : 'vbr',
    '-forced-idr', '1',
  ];
  if (settings.rateControl === 'quality') args.push('-cq', String(qualityQuantizer(settings.encoderQuality)));
  else appendBitrateArguments(args, settings);
  return args;
}

function quickSyncArguments(settings: EncoderArguments): string[] {
  const presets = ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
  const preset = presets[Math.round(settings.encoderQuality * (presets.length - 1) / 100)]!;
  const args = ['-c:v', 'h264_qsv', '-preset', preset, '-scenario', settings.scenario === 'live_streaming' ? 'livestreaming' : 'archive'];
  if (settings.scenario === 'live_streaming') args.push('-bf', '0');
  appendBitrateArguments(args, settings);
  return args;
}

function amdArguments(settings: EncoderArguments): string[] {
  const quality = settings.encoderQuality < 25 ? 'speed'
    : settings.encoderQuality < 50 ? 'balanced'
      : settings.encoderQuality < 75 ? 'quality' : 'high_quality';
  const rateControl = settings.rateControl === 'cbr' ? 'cbr'
    : settings.rateControl === 'pc_vbr' ? 'vbr_peak'
      : settings.rateControl === 'u_vbr' ? 'vbr_latency' : 'qvbr';
  const args = [
    '-c:v', 'h264_amf',
    '-usage', settings.scenario === 'live_streaming' ? 'lowlatency_high_quality' : 'high_quality',
    '-quality', quality,
    '-rc', rateControl,
  ];
  if (settings.rateControl === 'quality') args.push('-qvbr_quality_level', String(qualityQuantizer(settings.encoderQuality)));
  else appendBitrateArguments(args, settings);
  return args;
}

function openH264Arguments(settings: EncoderArguments): string[] {
  const args = ['-c:v', 'libopenh264', '-rc_mode', 'bitrate'];
  appendBitrateArguments(args, settings);
  return args;
}

function buildVideoEncoderArguments(settings: EncoderArguments): string[] {
  validateEncoderArguments(settings);
  const args = settings.encoder === 'h264_mf' ? mediaFoundationArguments(settings)
    : settings.encoder === 'h264_nvenc' ? nvencArguments(settings)
      : settings.encoder === 'h264_qsv' ? quickSyncArguments(settings)
        : settings.encoder === 'h264_amf' ? amdArguments(settings)
          : openH264Arguments(settings);
  if (settings.width !== undefined && settings.height !== undefined) args.push('-s:v', `${settings.width}x${settings.height}`);
  const pixelFormat = settings.encoder === 'h264_qsv' ? 'nv12' : 'yuv420p';
  args.push('-pix_fmt', pixelFormat, '-r', String(settings.frameRate), '-g', String(settings.frameRate * settings.keyframeIntervalSeconds));
  return args;
}

export function buildStreamVideoEncoderArguments(settings: StreamOutputSettings): string[] {
  return buildVideoEncoderArguments({ ...settings, scenario: 'live_streaming', width: settings.width, height: settings.height });
}

export function buildRecordingVideoEncoderArguments(settings: RecordingOutputSettings): string[] {
  return buildVideoEncoderArguments({ ...settings, scenario: 'archive' });
}

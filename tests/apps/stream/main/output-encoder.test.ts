// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildRecordingVideoEncoderArguments, buildStreamVideoEncoderArguments } from '../../../../apps/stream/main/output-encoder';
import type { RecordingOutputSettings, StreamOutputSettings } from '../../../../apps/stream/shared/desktop-api';

const streamSettings: StreamOutputSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  rateControl: 'cbr',
  encoder: 'h264_mf',
  encoderQuality: 60,
  hardwareEncoding: false,
  keyframeIntervalSeconds: 2,
};

describe('LumaStream Media Foundation encoder arguments', () => {
  it('sets a CBR target, buffer, frame size, and configured GOP interval for streaming', () => {
    const args = buildStreamVideoEncoderArguments(streamSettings);
    expect(args).toEqual(expect.arrayContaining([
      '-scenario', 'live_streaming', '-rate_control', 'cbr', '-quality', '60', '-hw_encoding', '0',
      '-s:v', '1920x1080', '-b:v', '6000k', '-maxrate', '6000k', '-bufsize', '12000k', '-g', '60',
    ]));
  });

  it('maps constrained VBR to a peak rate above the target', () => {
    const args = buildStreamVideoEncoderArguments({ ...streamSettings, rateControl: 'pc_vbr' });
    expect(args).toContain('-rate_control');
    expect(args).toContain('pc_vbr');
    expect(args).toContain('-maxrate');
    expect(args).toContain('9000k');
    expect(args).toContain('-bufsize');
    expect(args).toContain('18000k');
  });

  it('omits bitrate constraints in quality mode and can require hardware encoding', () => {
    const args = buildStreamVideoEncoderArguments({ ...streamSettings, rateControl: 'quality', hardwareEncoding: true, keyframeIntervalSeconds: 1 });
    expect(args).toContain('-quality');
    expect(args).toContain('60');
    expect(args).toContain('-hw_encoding');
    expect(args).toContain('1');
    expect(args).toContain('-g');
    expect(args).toContain('30');
    expect(args).not.toContain('-b:v');
    expect(args).not.toContain('-maxrate');
  });

  it('uses the archive scenario for MP4 recording and rejects invalid keyframe intervals', () => {
    const settings: RecordingOutputSettings = {
      container: 'mp4', frameRate: 60, videoBitrateKbps: 8000, audioBitrateKbps: 160, audioTracks: [1],
      rateControl: 'cbr', encoder: 'h264_mf', encoderQuality: 60, hardwareEncoding: false, keyframeIntervalSeconds: 2,
    };
    expect(buildRecordingVideoEncoderArguments(settings)).toContain('archive');
    expect(() => buildStreamVideoEncoderArguments({ ...streamSettings, keyframeIntervalSeconds: 11 })).toThrow(/outside the supported range/);
  });

  it('accepts the supported quality and keyframe boundaries and rejects out-of-range quality', () => {
    const args = buildStreamVideoEncoderArguments({ ...streamSettings, encoderQuality: 0, keyframeIntervalSeconds: 10 });
    expect(args.slice(args.indexOf('-quality'), args.indexOf('-quality') + 2)).toEqual(['-quality', '0']);
    expect(args.slice(args.indexOf('-g'), args.indexOf('-g') + 2)).toEqual(['-g', '300']);
    expect(() => buildStreamVideoEncoderArguments({ ...streamSettings, encoderQuality: 101 })).toThrow(/outside the supported range/);
  });

  it('builds NVIDIA NVENC CBR and quality-mode arguments', () => {
    const cbr = buildStreamVideoEncoderArguments({ ...streamSettings, encoder: 'h264_nvenc' });
    expect(cbr).toEqual(expect.arrayContaining(['-c:v', 'h264_nvenc', '-rc', 'cbr', '-preset', 'p5', '-b:v', '6000k', '-maxrate', '6000k', '-g', '60']));
    const quality = buildStreamVideoEncoderArguments({ ...streamSettings, encoder: 'h264_nvenc', rateControl: 'quality' });
    expect(quality).toEqual(expect.arrayContaining(['-rc', 'vbr', '-cq', '21']));
    expect(quality).not.toContain('-b:v');
  });

  it('builds Intel Quick Sync and AMD AMF rate-control arguments', () => {
    const qsv = buildStreamVideoEncoderArguments({ ...streamSettings, encoder: 'h264_qsv', rateControl: 'pc_vbr' });
    expect(qsv).toEqual(expect.arrayContaining(['-c:v', 'h264_qsv', '-scenario', 'livestreaming', '-maxrate', '9000k', '-pix_fmt', 'nv12', '-g', '60']));
    const amf = buildStreamVideoEncoderArguments({ ...streamSettings, encoder: 'h264_amf', rateControl: 'quality' });
    expect(amf).toEqual(expect.arrayContaining(['-c:v', 'h264_amf', '-rc', 'qvbr', '-qvbr_quality_level', '21']));
    expect(amf).not.toContain('-b:v');
  });

  it('builds software OpenH264 output and rejects unsupported rate-control modes', () => {
    const args = buildRecordingVideoEncoderArguments({
      container: 'mp4', frameRate: 30, videoBitrateKbps: 8000, audioBitrateKbps: 160, audioTracks: [1],
      rateControl: 'cbr', encoder: 'libopenh264', encoderQuality: 60, hardwareEncoding: false, keyframeIntervalSeconds: 2,
    });
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libopenh264', '-rc_mode', 'bitrate', '-b:v', '8000k', '-maxrate', '8000k']));
    expect(() => buildStreamVideoEncoderArguments({ ...streamSettings, encoder: 'libopenh264', rateControl: 'quality' })).toThrow(/outside the supported range/);
    expect(() => buildStreamVideoEncoderArguments({ ...streamSettings, encoder: 'h264_qsv', rateControl: 'quality' })).toThrow(/outside the supported range/);
  });
});

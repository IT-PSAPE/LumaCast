import type { NdiFrame } from '../shared/ndi';

export function ndiVideoRgba(frame: Extract<NdiFrame, { kind: 'video' }>): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, stride, data } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > 8_294_400 || !Number.isInteger(stride) || stride < width * 4
    || data.byteLength < stride * height) throw new Error('Invalid NDI video frame.');
  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = y * stride + x * 4;
      const to = (y * width + x) * 4;
      result[to] = data[from + 2];
      result[to + 1] = data[from + 1];
      result[to + 2] = data[from];
      result[to + 3] = data[from + 3];
    }
  }
  return result;
}

export function ndiAudioChannels(frame: Extract<NdiFrame, { kind: 'audio' }>): Float32Array[] {
  const stride = frame.channelStrideBytes / 4;
  if (!Number.isInteger(frame.sampleRate) || frame.sampleRate < 8000 || frame.sampleRate > 192000
    || !Number.isInteger(frame.channels) || frame.channels < 1 || frame.channels > 16
    || !Number.isInteger(frame.samplesPerChannel) || frame.samplesPerChannel < 1 || frame.samplesPerChannel > 192000
    || !Number.isInteger(stride) || stride < frame.samplesPerChannel
    || frame.data.length < stride * (frame.channels - 1) + frame.samplesPerChannel) {
    throw new Error('Invalid NDI audio frame.');
  }
  return Array.from({ length: Math.min(2, frame.channels) }, (_, channel) => {
    const result = frame.data.slice(channel * stride, channel * stride + frame.samplesPerChannel);
    for (let i = 0; i < result.length; i++) result[i] = Number.isFinite(result[i]) ? Math.max(-1, Math.min(1, result[i])) : 0;
    return result;
  });
}

export function ndiOutputSize(width: number, height: number) {
  const scale = Math.min(1, 1920 / width, 1080 / height);
  return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) };
}

export function ndiOutputFrameRate(frameRate: number) {
  return Math.min(60, frameRate);
}

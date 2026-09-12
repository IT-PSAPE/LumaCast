import { describe, expect, it } from 'vitest';
import {
  NDI_AUDIO_TRANSPORT_MAX_CHANNELS,
  NDI_AUDIO_TRANSPORT_MAX_SAMPLE_RATE,
  NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL,
  NDI_AUDIO_TRANSPORT_VERSION,
  NDI_AUDIO_TRANSPORT_WINDOW_MESSAGE,
  decodeNdiAudioTransportFrame,
  isNdiAudioTransportHandshake,
  isNdiAudioTransportPortAnnouncement,
  type NdiAudioTransportFrame,
} from '../../../../packages/protocol/src/index';

function audioBytes(channels: number, samplesPerChannel: number): number {
  return channels * samplesPerChannel * 4;
}

function validAudioFrame(overrides: Partial<NdiAudioTransportFrame> = {}): NdiAudioTransportFrame {
  return {
    type: 'audio',
    name: 'audience',
    buffer: new ArrayBuffer(audioBytes(2, 48)),
    sampleRate: 48000,
    channels: 2,
    samplesPerChannel: 48,
    ...overrides,
  };
}

describe('NDI direct audio transport contract', () => {
  it('accepts the current handshake only for the expected output', () => {
    expect(isNdiAudioTransportHandshake({
      type: 'handshake',
      version: NDI_AUDIO_TRANSPORT_VERSION,
      name: 'audience',
    }, 'audience')).toBe(true);
    expect(isNdiAudioTransportHandshake({
      type: 'handshake',
      version: NDI_AUDIO_TRANSPORT_VERSION + 1,
      name: 'audience',
    }, 'audience')).toBe(false);
    expect(isNdiAudioTransportHandshake({
      type: 'handshake',
      version: NDI_AUDIO_TRANSPORT_VERSION,
      name: 'stage',
    }, 'audience')).toBe(false);
  });

  it('recognizes a well-formed port announcement', () => {
    expect(isNdiAudioTransportPortAnnouncement({
      type: NDI_AUDIO_TRANSPORT_WINDOW_MESSAGE,
      version: NDI_AUDIO_TRANSPORT_VERSION,
      name: 'audience',
    })).toBe(true);
    expect(isNdiAudioTransportPortAnnouncement({
      type: NDI_AUDIO_TRANSPORT_WINDOW_MESSAGE,
      version: NDI_AUDIO_TRANSPORT_VERSION + 1,
      name: 'audience',
    })).toBe(false);
    expect(isNdiAudioTransportPortAnnouncement({
      type: NDI_AUDIO_TRANSPORT_WINDOW_MESSAGE,
      version: NDI_AUDIO_TRANSPORT_VERSION,
      name: 'unlisted',
    })).toBe(false);
  });

  it('decodes an exact planar float32 audio frame and preserves the buffer', () => {
    const buffer = new ArrayBuffer(audioBytes(2, 48));
    const decoded = decodeNdiAudioTransportFrame({
      type: 'audio',
      name: 'audience',
      buffer,
      sampleRate: 48000,
      channels: 2,
      samplesPerChannel: 48,
    }, 'audience');

    expect(decoded).not.toBeNull();
    expect(decoded?.buffer).toBe(buffer);
    expect(decoded).toMatchObject({
      type: 'audio',
      name: 'audience',
      sampleRate: 48000,
      channels: 2,
      samplesPerChannel: 48,
    });
  });

  it.each([
    ['wrong output', validAudioFrame({ name: 'stage' })],
    ['sample rate of zero', validAudioFrame({ sampleRate: 0 })],
    ['negative sample rate', validAudioFrame({ sampleRate: -1 })],
    ['fractional sample rate', validAudioFrame({ sampleRate: 48000.5 })],
    ['sample rate above 192000', validAudioFrame({ sampleRate: NDI_AUDIO_TRANSPORT_MAX_SAMPLE_RATE + 1 })],
    ['channels of zero', validAudioFrame({ channels: 0 })],
    ['negative channels', validAudioFrame({ channels: -2 })],
    ['fractional channel count', validAudioFrame({ channels: 2.5 })],
    ['channels above 32', validAudioFrame({ channels: NDI_AUDIO_TRANSPORT_MAX_CHANNELS + 1 })],
    ['samples per channel of zero', validAudioFrame({ samplesPerChannel: 0 })],
    ['negative samples per channel', validAudioFrame({ samplesPerChannel: -48 })],
    ['fractional sample count', validAudioFrame({ samplesPerChannel: 48.5 })],
    ['samples above 192000', validAudioFrame({ samplesPerChannel: NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL + 1 })],
    ['short buffer', validAudioFrame({ buffer: new ArrayBuffer(audioBytes(2, 48) - 1) })],
    ['long buffer', validAudioFrame({ buffer: new ArrayBuffer(audioBytes(2, 48) + 1) })],
    ['typed-array view', { ...validAudioFrame(), buffer: new Float32Array(audioBytes(2, 48)) }],
  ])('rejects %s at the utility trust boundary', (_label, value) => {
    expect(decodeNdiAudioTransportFrame(value, 'audience')).toBeNull();
  });

  it('matches the engine audio submission caps byte-for-byte at the boundary', () => {
    expect(NDI_AUDIO_TRANSPORT_MAX_CHANNELS).toBe(32);
    expect(NDI_AUDIO_TRANSPORT_MAX_SAMPLE_RATE).toBe(192000);
    expect(NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL).toBe(192000);
    const maxFrame = decodeNdiAudioTransportFrame(validAudioFrame({
      sampleRate: NDI_AUDIO_TRANSPORT_MAX_SAMPLE_RATE,
      channels: NDI_AUDIO_TRANSPORT_MAX_CHANNELS,
      samplesPerChannel: NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL,
      buffer: new ArrayBuffer(audioBytes(NDI_AUDIO_TRANSPORT_MAX_CHANNELS, NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL)),
    }), 'audience');
    expect(maxFrame).not.toBeNull();
  });
});
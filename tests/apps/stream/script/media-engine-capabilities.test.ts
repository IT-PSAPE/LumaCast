import { describe, expect, it } from 'vitest';
import { assertRequiredOutputProtocols } from '../../../../apps/stream/script/media-engine-capabilities.mjs';

describe('Stream media engine output protocols', () => {
  it('accepts builds with both SRT and RIST output', () => {
    expect(() => assertRequiredOutputProtocols(`Supported file protocols:\nInput:\n  rist\n  srt\nOutput:\n  file\n  rist\n  srt\n`)).not.toThrow();
  });

  it('rejects protocols that are available only for input', () => {
    expect(() => assertRequiredOutputProtocols(`Supported file protocols:\nInput:\n  rist\n  srt\nOutput:\n  file\n`)).toThrow('missing required output protocols: rist, srt');
  });

  it('reports a missing transport individually', () => {
    expect(() => assertRequiredOutputProtocols(`Input:\n  rist\nOutput:\n  file\n  srt\n`)).toThrow('missing required output protocols: rist');
  });

  it('rejects FFmpeg output without a protocol section', () => {
    expect(() => assertRequiredOutputProtocols('Unsupported option')).toThrow('did not report its output protocols');
  });
});

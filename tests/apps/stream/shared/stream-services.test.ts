import { describe, expect, it } from 'vitest';
import { createDefaultStreamServiceSettings, type StreamServiceSettings } from '../../../../apps/stream/shared/desktop-api';
import { getStreamService, resolveStreamDestination, STREAM_SERVICES, validateStreamServiceSettings } from '../../../../apps/stream/shared/stream-services';

function withSettings(patch: Partial<StreamServiceSettings>): StreamServiceSettings {
  return { ...createDefaultStreamServiceSettings(), ...patch };
}

describe('STREAM_SERVICES presets', () => {
  it('exposes youtube, twitch, kick, facebook, and custom', () => {
    expect(STREAM_SERVICES.map((service) => service.id)).toEqual(['youtube', 'twitch', 'kick', 'facebook', 'custom']);
  });

  it('never advertises the YouTube backup ingest, since it cannot pass the output validator', () => {
    // rtmps://b.rtmps.youtube.com:443/live2?backup=1 always carries a query
    // string; stream-output.ts's validateDestination rejects any query string
    // on an rtmp(s) destination no matter where the key is placed, so the
    // backup server is intentionally left out of the preset.
    const youtube = getStreamService('youtube');
    expect(youtube.servers.some((server) => server.url.includes('backup'))).toBe(false);
    expect(youtube.servers.map((server) => server.url)).toEqual([
      'rtmps://a.rtmps.youtube.com:443/live2',
      'rtmp://a.rtmp.youtube.com/live2',
    ]);
  });

  it('carries the documented ingest URLs for the remaining presets', () => {
    expect(getStreamService('twitch').servers.map((server) => server.url)).toEqual(['rtmp://live.twitch.tv/app']);
    expect(getStreamService('kick').servers.map((server) => server.url)).toEqual(['rtmps://fa723fc1b171.global-contribute.live-video.net:443/app']);
    expect(getStreamService('facebook').servers.map((server) => server.url)).toEqual(['rtmps://rtmp-api.facebook.com:443/rtmp/']);
    expect(getStreamService('custom').servers).toEqual([]);
  });

  it('throws for an id with no matching preset', () => {
    // @ts-expect-error exercising the runtime guard with an invalid id
    expect(() => getStreamService('invalid')).toThrow(/Unknown stream service/);
  });
});

describe('resolveStreamDestination', () => {
  it('joins the selected YouTube server with the stream key', () => {
    const settings = withSettings({ service: 'youtube', serverId: 'primary', streamKey: 'abcd-1234' });
    expect(resolveStreamDestination(settings)).toBe('rtmps://a.rtmps.youtube.com:443/live2/abcd-1234');
  });

  it('supports the legacy plain-RTMP YouTube server', () => {
    const settings = withSettings({ service: 'youtube', serverId: 'legacy', streamKey: 'abcd-1234' });
    expect(resolveStreamDestination(settings)).toBe('rtmp://a.rtmp.youtube.com/live2/abcd-1234');
  });

  it('resolves Twitch, Kick, and Facebook destinations', () => {
    expect(resolveStreamDestination(withSettings({ service: 'twitch', serverId: 'default', streamKey: 'key' })))
      .toBe('rtmp://live.twitch.tv/app/key');
    expect(resolveStreamDestination(withSettings({ service: 'kick', serverId: 'default', streamKey: 'key' })))
      .toBe('rtmps://fa723fc1b171.global-contribute.live-video.net:443/app/key');
    expect(resolveStreamDestination(withSettings({ service: 'facebook', serverId: 'default', streamKey: 'key' })))
      .toBe('rtmps://rtmp-api.facebook.com:443/rtmp/key');
  });

  it('percent-encodes an unusual stream key so it cannot inject a path segment or query', () => {
    const settings = withSettings({ service: 'twitch', serverId: 'default', streamKey: 'weird key/with?chars#here' });
    expect(resolveStreamDestination(settings)).toBe('rtmp://live.twitch.tv/app/weird%20key%2Fwith%3Fchars%23here');
  });

  it('returns null when a preset service is missing its key or server', () => {
    expect(resolveStreamDestination(withSettings({ service: 'youtube', serverId: 'primary', streamKey: '' }))).toBeNull();
    expect(resolveStreamDestination(withSettings({ service: 'youtube', serverId: 'unknown-server', streamKey: 'key' }))).toBeNull();
  });

  it('resolves a custom server with and without a key', () => {
    const withKey = withSettings({ service: 'custom', customServer: 'rtmp://example.com/live', streamKey: 'key' });
    expect(resolveStreamDestination(withKey)).toBe('rtmp://example.com/live/key');

    const withoutKey = withSettings({ service: 'custom', customServer: 'srt://example.com:9000' });
    expect(resolveStreamDestination(withoutKey)).toBe('srt://example.com:9000');
  });

  it('returns null for an empty or invalid custom server', () => {
    expect(resolveStreamDestination(withSettings({ service: 'custom', customServer: '' }))).toBeNull();
    expect(resolveStreamDestination(withSettings({ service: 'custom', customServer: 'not a url' }))).toBeNull();
  });
});

describe('validateStreamServiceSettings', () => {
  it('requires a stream key for preset services', () => {
    expect(validateStreamServiceSettings(withSettings({ service: 'youtube', serverId: 'primary', streamKey: '' })))
      .toBe('Enter a stream key.');
  });

  it('requires a recognized server for preset services', () => {
    expect(validateStreamServiceSettings(withSettings({ service: 'youtube', serverId: 'unknown-server', streamKey: 'key' })))
      .toBe('Select an ingest server.');
  });

  it('requires a server URL for custom', () => {
    expect(validateStreamServiceSettings(withSettings({ service: 'custom', customServer: '' }))).toBe('Enter a server URL.');
  });

  it('rejects a custom server URL the output validator would reject', () => {
    expect(validateStreamServiceSettings(withSettings({ service: 'custom', customServer: 'not a url' })))
      .toBe('Enter a valid RTMP, RTMPS, SRT, or RIST server URL.');
  });

  it('passes for a complete, valid preset or custom configuration', () => {
    expect(validateStreamServiceSettings(withSettings({ service: 'youtube', serverId: 'primary', streamKey: 'abcd-1234' }))).toBeNull();
    expect(validateStreamServiceSettings(withSettings({ service: 'custom', customServer: 'srt://example.com:9000' }))).toBeNull();
  });
});

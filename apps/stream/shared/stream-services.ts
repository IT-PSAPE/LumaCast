import type { StreamServiceSettings } from './desktop-api';

export type StreamServiceId = 'youtube' | 'twitch' | 'kick' | 'facebook' | 'custom';

export interface StreamServer {
  id: string;
  label: string;
  url: string;
}

export interface StreamServicePreset {
  id: StreamServiceId;
  label: string;
  servers: StreamServer[];
  keyLabel: string;
  dashboardUrl?: string;
  dashboardLabel?: string;
  recommended: { keyframeIntervalSeconds: number; audioBitrateKbps: number; maxVideoBitrateKbps: number };
}

// Ingest URLs verified against OBS's own plugins/rtmp-services/data/services.json
// (format_version 5) and the YouTube Live help center; see the parity doc for
// sourcing notes. The YouTube backup server (`.../live2?backup=1`) is
// deliberately omitted: appending the stream key ahead of the query string
// still leaves a non-empty `url.search`, which `validateDestination` in
// `apps/stream/main/stream-output.ts` rejects for rtmp(s) destinations (no
// query strings allowed), so there is no way to route the backup ingest
// through that validator today.
export const STREAM_SERVICES: readonly StreamServicePreset[] = [
  {
    id: 'youtube',
    label: 'YouTube - RTMPS',
    servers: [
      { id: 'primary', label: 'Primary (RTMPS)', url: 'rtmps://a.rtmps.youtube.com:443/live2' },
      { id: 'legacy', label: 'Primary (RTMP, legacy)', url: 'rtmp://a.rtmp.youtube.com/live2' },
    ],
    keyLabel: 'Stream Key',
    dashboardUrl: 'https://studio.youtube.com/',
    dashboardLabel: 'Open YouTube Studio',
    recommended: { keyframeIntervalSeconds: 2, audioBitrateKbps: 160, maxVideoBitrateKbps: 51000 },
  },
  {
    id: 'twitch',
    label: 'Twitch',
    servers: [{ id: 'default', label: 'Default', url: 'rtmp://live.twitch.tv/app' }],
    keyLabel: 'Stream Key',
    dashboardUrl: 'https://dashboard.twitch.tv/',
    dashboardLabel: 'Open Twitch Dashboard',
    recommended: { keyframeIntervalSeconds: 2, audioBitrateKbps: 320, maxVideoBitrateKbps: 6000 },
  },
  {
    id: 'kick',
    label: 'Kick',
    servers: [{ id: 'default', label: 'Default', url: 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app' }],
    keyLabel: 'Stream Key',
    dashboardUrl: 'https://kick.com/dashboard',
    dashboardLabel: 'Open Kick Dashboard',
    recommended: { keyframeIntervalSeconds: 2, audioBitrateKbps: 160, maxVideoBitrateKbps: 8000 },
  },
  {
    id: 'facebook',
    label: 'Facebook Live',
    servers: [{ id: 'default', label: 'Default', url: 'rtmps://rtmp-api.facebook.com:443/rtmp/' }],
    keyLabel: 'Stream Key',
    dashboardUrl: 'https://www.facebook.com/live/producer',
    dashboardLabel: 'Open Facebook Live Producer',
    recommended: { keyframeIntervalSeconds: 2, audioBitrateKbps: 128, maxVideoBitrateKbps: 9000 },
  },
  {
    id: 'custom',
    label: 'Custom',
    servers: [],
    keyLabel: 'Stream Key',
    recommended: { keyframeIntervalSeconds: 2, audioBitrateKbps: 160, maxVideoBitrateKbps: 6000 },
  },
];

export function getStreamService(id: StreamServiceId): StreamServicePreset {
  const preset = STREAM_SERVICES.find((service) => service.id === id);
  if (!preset) throw new Error(`Unknown stream service: ${id}`);
  return preset;
}

function joinServerAndKey(serverUrl: string, key: string): string {
  const trimmedServer = serverUrl.replace(/\/+$/, '');
  return `${trimmedServer}/${encodeURIComponent(key)}`;
}

/**
 * Mirrors the destination shape enforced by the unexported `validateDestination`
 * in `apps/stream/main/stream-output.ts`, so a destination this module resolves
 * is never handed to the renderer's Go Live action only to be rejected by the
 * output process. Duplicated rather than imported because that function is a
 * main-process-only internal of `StreamOutput`; keep the two in sync if either
 * changes.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isValidStreamDestination(value: string): boolean {
  if (value.length > 2048 || hasControlCharacter(value) || value.includes('#')) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === 'srt:' || url.protocol === 'rist:') {
    return Boolean(url.hostname) && Boolean(url.port) && (url.pathname === '' || url.pathname === '/');
  }
  if (url.protocol !== 'rtmp:' && url.protocol !== 'rtmps:') return false;
  return Boolean(url.hostname) && Boolean(url.pathname) && url.pathname !== '/' && !url.search;
}

/**
 * Builds the final server+key destination for a preset service, or the custom
 * server (with the key appended when present) for `service: 'custom'`.
 * Returns null when settings are incomplete (no server selected, no key for a
 * preset service, no URL for custom) or when the assembled destination would
 * fail `isValidStreamDestination`.
 */
export function resolveStreamDestination(settings: StreamServiceSettings): string | null {
  const key = settings.streamKey.trim();
  if (settings.service === 'custom') {
    const server = settings.customServer.trim();
    if (!server) return null;
    const destination = key ? joinServerAndKey(server, key) : server;
    return isValidStreamDestination(destination) ? destination : null;
  }
  if (!key) return null;
  const preset = getStreamService(settings.service);
  const server = preset.servers.find((candidate) => candidate.id === settings.serverId);
  if (!server) return null;
  const destination = joinServerAndKey(server.url, key);
  return isValidStreamDestination(destination) ? destination : null;
}

/** Returns a user-facing error message, or null when the settings are ready to stream. */
export function validateStreamServiceSettings(settings: StreamServiceSettings): string | null {
  if (settings.service === 'custom') {
    const server = settings.customServer.trim();
    if (!server) return 'Enter a server URL.';
    const key = settings.streamKey.trim();
    const destination = key ? joinServerAndKey(server, key) : server;
    if (!isValidStreamDestination(destination)) return 'Enter a valid RTMP, RTMPS, SRT, or RIST server URL.';
    return null;
  }
  const preset = getStreamService(settings.service);
  const server = preset.servers.find((candidate) => candidate.id === settings.serverId);
  if (!server) return 'Select an ingest server.';
  const key = settings.streamKey.trim();
  if (!key) return 'Enter a stream key.';
  if (!isValidStreamDestination(joinServerAndKey(server.url, key))) return 'Enter a valid stream key.';
  return null;
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDefaultStreamServiceSettings, type StreamServiceSettings, type YouTubePrivacy } from '../shared/desktop-api';
import { STREAM_SERVICES, getStreamService, type StreamServiceId } from '../shared/stream-services';
import { electronSecureStorage, type SecureStorage } from './secure-storage';

type StreamKeyEncoding = 'safe-storage' | 'plain';

interface PersistedStreamServiceSettings {
  version: 1;
  service: StreamServiceId;
  serverId: string;
  customServer: string;
  streamKeyEncoding: StreamKeyEncoding;
  streamKey: string;
  youtube: { title: string; description: string; privacy: YouTubePrivacy; broadcastId: string; scheduledStartTime: string };
  zoom?: { selectedMeetingId?: string; topic?: string; startTime?: string; durationMinutes?: number };
}

function clampString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function normalizePrivacy(value: unknown): YouTubePrivacy {
  return value === 'public' || value === 'unlisted' || value === 'private' ? value : 'unlisted';
}

function normalizeServiceId(value: unknown): StreamServiceId {
  return STREAM_SERVICES.some((service) => service.id === value) ? (value as StreamServiceId) : 'youtube';
}

function normalizeServerId(service: StreamServiceId, value: unknown): string {
  const preset = getStreamService(service);
  if (preset.servers.some((server) => server.id === value)) return value as string;
  return preset.servers[0]?.id ?? '';
}

/**
 * Normalizes an arbitrary (already-decrypted) settings payload into a valid
 * `StreamServiceSettings`: an unrecognized shape becomes full defaults, and an
 * unknown service/server id or oversized string is clamped rather than
 * rejected, so a corrupt or stale persisted file degrades gracefully instead
 * of blocking the dock from loading.
 */
function decodeStreamServiceSettings(value: unknown): StreamServiceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createDefaultStreamServiceSettings();
  const raw = value as Record<string, unknown>;
  const service = normalizeServiceId(raw.service);
  const serverId = normalizeServerId(service, raw.serverId);
  const customServer = clampString(raw.customServer, 2048);
  const streamKey = clampString(raw.streamKey, 512);
  const youtubeRaw = raw.youtube && typeof raw.youtube === 'object' && !Array.isArray(raw.youtube) ? (raw.youtube as Record<string, unknown>) : {};
  const zoomRaw = raw.zoom && typeof raw.zoom === 'object' && !Array.isArray(raw.zoom) ? (raw.zoom as Record<string, unknown>) : {};
  return {
    service,
    serverId,
    customServer,
    streamKey,
    youtube: {
      title: clampString(youtubeRaw.title, 100),
      description: clampString(youtubeRaw.description, 5000),
      privacy: normalizePrivacy(youtubeRaw.privacy),
      broadcastId: clampString(youtubeRaw.broadcastId, 128),
      scheduledStartTime: clampString(youtubeRaw.scheduledStartTime, 64),
    },
    zoom: {
      selectedMeetingId: clampString(zoomRaw.selectedMeetingId, 32),
      topic: clampString(zoomRaw.topic, 200),
      startTime: clampString(zoomRaw.startTime, 64),
      durationMinutes: typeof zoomRaw.durationMinutes === 'number' && Number.isInteger(zoomRaw.durationMinutes)
        ? Math.max(1, Math.min(1440, zoomRaw.durationMinutes))
        : 60,
    },
  };
}

function encodeStreamKey(streamKey: string, secureStorage: SecureStorage): { encoding: StreamKeyEncoding; value: string } {
  if (streamKey.length > 0 && secureStorage.isEncryptionAvailable()) {
    return { encoding: 'safe-storage', value: secureStorage.encryptString(streamKey).toString('base64') };
  }
  return { encoding: 'plain', value: streamKey };
}

function decodeStreamKey(encoding: unknown, value: unknown, secureStorage: SecureStorage): string {
  const raw = typeof value === 'string' ? value : '';
  if (raw === '') return '';
  if (encoding === 'safe-storage') {
    if (!secureStorage.isEncryptionAvailable()) return '';
    try {
      return secureStorage.decryptString(Buffer.from(raw, 'base64'));
    } catch {
      return '';
    }
  }
  return raw;
}

/**
 * Stores the YouTube Live Control Panel's stream service settings at
 * `<dataDirectory>/stream-settings.json`, written atomically following the
 * pattern in `recording-preferences-store.ts`. The stream key is encrypted at
 * rest with Electron's `safeStorage` (OS keychain-backed) whenever it is
 * available; otherwise it is written in plain text with
 * `streamKeyEncoding: "plain"` so a round trip never silently loses the key.
 * The key is never logged. Unlike `RecordingPreferencesStore`, `load()` never
 * throws: a missing, oversized, corrupt, or otherwise malformed file falls
 * back to defaults rather than surfacing a decode error, since this store
 * backs a dock that should always render something usable.
 */
export class StreamSettingsStore {
  private readonly filePath: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string, private readonly secureStorage: SecureStorage = electronSecureStorage) {
    this.filePath = path.join(dataDirectory, 'stream-settings.json');
  }

  async load(): Promise<StreamServiceSettings> {
    try {
      const bytes = await readFile(this.filePath);
      if (bytes.length > 64 * 1024) throw new Error('Stream service settings file is too large.');
      const parsed: unknown = JSON.parse(bytes.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as { version?: unknown }).version !== 1) {
        return createDefaultStreamServiceSettings();
      }
      const record = parsed as Record<string, unknown>;
      const streamKey = decodeStreamKey(record.streamKeyEncoding, record.streamKey, this.secureStorage);
      return decodeStreamServiceSettings({ ...record, streamKey });
    } catch {
      return createDefaultStreamServiceSettings();
    }
  }

  async save(value: unknown): Promise<StreamServiceSettings> {
    const settings = decodeStreamServiceSettings(value);
    const saving = this.saveQueue.then(() => this.persist(settings));
    this.saveQueue = saving.then(() => undefined, () => undefined);
    await saving;
    return settings;
  }

  private async persist(settings: StreamServiceSettings): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    const encryptedKey = encodeStreamKey(settings.streamKey, this.secureStorage);
    const payload: PersistedStreamServiceSettings = {
      version: 1,
      service: settings.service,
      serverId: settings.serverId,
      customServer: settings.customServer,
      streamKeyEncoding: encryptedKey.encoding,
      streamKey: encryptedKey.value,
      youtube: settings.youtube,
      zoom: settings.zoom,
    };
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(payload), 'utf8');
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

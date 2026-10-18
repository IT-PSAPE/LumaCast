import { MessageChannelMain, app, type MessagePortMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { StreamOutputSettings, StreamRuntimeStatus } from '../shared/desktop-api';
import { IPC_CHANNELS } from './ipc-channels';
import { ZoomLiveService } from './zoom-live';

interface ZoomSdkResult { ok: boolean; message: string }
interface ZoomSdkEvent { state: string; message: string }
interface ZoomSdkAddon {
  initialize(publicAppKey: string, onEvent: (event: ZoomSdkEvent) => void): ZoomSdkResult;
  startMeeting(meetingNumber: string, zak: string, zoomUserId: string, displayName: string): ZoomSdkResult;
  startProductionStudio(width: number, height: number): ZoomSdkResult;
  sendVideoFrame(data: Buffer, width: number, height: number): ZoomSdkResult;
  sendAudioFrame(data: Buffer, sampleRate: number, channels: number): ZoomSdkResult;
  stop(): void;
}

interface ZoomMediaMessage {
  type?: unknown;
  data?: unknown;
  width?: unknown;
  height?: unknown;
  sampleRate?: unknown;
  channels?: unknown;
}

interface ZoomSession {
  id: string;
  meetingId: string;
  settings: StreamOutputSettings;
  port: MessagePortMain;
  addon: ZoomSdkAddon;
  stopping: boolean;
  meetingStarted: boolean;
  studioRequested: boolean;
}

const MAX_VIDEO_PIXELS = 3840 * 2160;
const MAX_PCM_BYTES = 3840;

function validSettings(value: StreamOutputSettings): boolean {
  return Number.isInteger(value.width) && Number.isInteger(value.height)
    && value.width >= 320 && value.width <= 3840 && value.width % 2 === 0
    && value.height >= 240 && value.height <= 2160 && value.height % 2 === 0
    && value.width * value.height <= MAX_VIDEO_PIXELS;
}

function failIfRejected(result: ZoomSdkResult): void {
  if (!result?.ok) throw new Error(result?.message || 'Zoom Meeting SDK operation failed.');
}

/** Main-process owner for the single Zoom SDK session and its transferred media port. */
export class ZoomSdkStreaming {
  private active: ZoomSession | null = null;

  constructor(
    private readonly zoomLive: ZoomLiveService,
    private readonly getContents: () => WebContents | null,
  ) {}

  async start(meetingId: string, settings: StreamOutputSettings): Promise<string> {
    if (this.active) throw new Error('A Zoom output is already active.');
    if (!/^\d{9,11}$/.test(meetingId)) throw new Error('Select a valid scheduled Zoom meeting.');
    if (!validSettings(settings)) throw new Error('Zoom output must be between 320×240 and 3840×2160 with even dimensions.');
    const contents = this.getContents();
    if (!contents || contents.isDestroyed()) throw new Error('The Stream window is not available.');
    const account = await this.zoomLive.getAccount();
    if (!account) throw new Error('Connect a Zoom account before starting a Zoom output.');
    const [zak, publicAppKey] = await Promise.all([this.zoomLive.getZak(), Promise.resolve(this.zoomLive.getSdkPublicAppKey())]);
    const addon = this.loadAddon();
    const id = randomUUID();
    const channel = new MessageChannelMain();
    const session: ZoomSession = {
      id, meetingId, settings: { ...settings }, port: channel.port1, addon,
      stopping: false, meetingStarted: false, studioRequested: false,
    };
    this.active = session;
    channel.port1.on('message', (event) => this.onMediaMessage(session, event.data as ZoomMediaMessage));
    channel.port1.start();
    this.emit({ outputId: 'zoom', state: 'connecting', message: 'Connecting to Zoom Meeting SDK.' });

    try {
      failIfRejected(addon.initialize(publicAppKey, (event) => this.onSdkEvent(session, event, account.userId, account.displayName, zak)));
      contents.postMessage(IPC_CHANNELS.zoomMediaPort, id, [channel.port2]);
      return id;
    } catch (error) {
      channel.port2.close();
      this.stopSession(session);
      this.emit({ outputId: 'zoom', state: 'error', message: error instanceof Error ? error.message : 'Zoom Meeting SDK could not initialize.' });
      throw error;
    }
  }

  stop(id: string): void {
    if (!this.active || this.active.id !== id) return;
    const session = this.active;
    this.stopSession(session);
    this.emit({ outputId: 'zoom', state: 'stopped', message: 'Zoom output stopped.' });
  }

  stopAll(): void {
    if (!this.active) return;
    const session = this.active;
    this.stopSession(session);
    this.emit({ outputId: 'zoom', state: 'stopped', message: 'Zoom output stopped.' });
  }

  private loadAddon(): ZoomSdkAddon {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      throw new Error('Zoom Meeting SDK streaming is supported on Windows and macOS only.');
    }
    const filename = process.platform === 'win32' ? 'lumastream-zoom-sdk.node' : 'lumastream-zoom-sdk.node';
    const addonPath = app.isPackaged
      ? path.join(process.resourcesPath, 'zoom-sdk', filename)
      : path.join(app.getAppPath(), 'native', 'zoom', 'build', 'Release', filename);
    try {
      if (process.platform === 'win32') {
        const sdkRoot = process.env.ZOOM_MEETING_SDK_ROOT;
        const runtimeBin = app.isPackaged ? path.join(process.resourcesPath, 'zoom-sdk', 'bin') : sdkRoot ? path.join(sdkRoot, 'bin') : '';
        if (runtimeBin && !process.env.PATH?.split(path.delimiter).includes(runtimeBin)) {
          process.env.PATH = [runtimeBin, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter);
        }
      }
      const addon = createRequire(path.join(app.getAppPath(), 'package.json'))(addonPath) as ZoomSdkAddon;
      return addon;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'native module unavailable';
      throw new Error(`Zoom Meeting SDK is not built or its runtime files are missing. Prepare the SDK for this platform, then restart LumaStream. (${reason})`);
    }
  }

  private onSdkEvent(session: ZoomSession, event: ZoomSdkEvent, userId: string, displayName: string, zak: string): void {
    if (this.active !== session || session.stopping) return;
    if (event.state === 'authenticated' && !session.meetingStarted) {
      session.meetingStarted = true;
      try { failIfRejected(session.addon.startMeeting(session.meetingId, zak, userId, displayName)); }
      catch (error) { this.fail(session, error instanceof Error ? error.message : 'Zoom could not join the selected meeting.'); }
      return;
    }
    if (event.state === 'meeting') {
      if (session.studioRequested) return;
      session.studioRequested = true;
      try { failIfRejected(session.addon.startProductionStudio(session.settings.width, session.settings.height)); }
      catch (error) { this.fail(session, error instanceof Error ? error.message : 'Zoom Production Studio could not start.'); }
      return;
    }
    if (event.state === 'production-studio') {
      this.emit({ outputId: 'zoom', state: 'live', message: event.message || 'Zoom is receiving the production output.' });
      return;
    }
    if (event.state === 'error') {
      this.fail(session, event.message || 'Zoom Meeting SDK reported an error.');
      return;
    }
    if (event.state === 'meeting-ended' || event.state === 'stopped') {
      this.stopSession(session);
      this.emit({ outputId: 'zoom', state: 'stopped', message: event.message || 'Zoom meeting ended.' });
      return;
    }
    if (event.state === 'meeting-connecting' || event.state === 'production-studio-starting') {
      this.emit({ outputId: 'zoom', state: 'connecting', message: event.message });
    }
  }

  private onMediaMessage(session: ZoomSession, value: ZoomMediaMessage): void {
    if (this.active !== session || session.stopping) return;
    if (!value || typeof value !== 'object' || !(value.data instanceof ArrayBuffer)) {
      this.fail(session, 'The Zoom media connection received an invalid frame.');
      return;
    }
    const data = Buffer.from(value.data);
    try {
      if (value.type === 'video') {
        if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
          || value.width !== session.settings.width || value.height !== session.settings.height
          || data.byteLength !== (value.width as number) * (value.height as number) * 3 / 2
          || data.byteLength > MAX_VIDEO_PIXELS * 3 / 2) {
          this.fail(session, 'The Zoom video frame does not match the selected output dimensions.');
          return;
        }
        failIfRejected(session.addon.sendVideoFrame(data, value.width as number, value.height as number));
        session.port.postMessage({ type: 'ack', media: 'video' });
      } else if (value.type === 'audio') {
        if (value.sampleRate !== 48000 || value.channels !== 2 || data.byteLength < 4
          || data.byteLength > MAX_PCM_BYTES || data.byteLength % 4 !== 0) {
          this.fail(session, 'Zoom audio must be stereo 48 kHz PCM in 20 ms packets.');
          return;
        }
        failIfRejected(session.addon.sendAudioFrame(data, 48000, 2));
        session.port.postMessage({ type: 'ack', media: 'audio' });
      } else {
        this.fail(session, 'The Zoom media connection received an unsupported frame type.');
      }
    } catch (error) {
      this.fail(session, error instanceof Error ? error.message : 'Zoom could not send a media frame.');
    }
  }

  private fail(session: ZoomSession, message: string): void {
    if (this.active !== session || session.stopping) return;
    this.stopSession(session);
    this.emit({ outputId: 'zoom', state: 'error', message });
  }

  private stopSession(session: ZoomSession): void {
    if (session.stopping) return;
    session.stopping = true;
    if (this.active === session) this.active = null;
    session.port.removeAllListeners();
    session.port.close();
    try { session.addon.stop(); } catch { /* The SDK may already have shut itself down. */ }
  }

  private emit(status: StreamRuntimeStatus): void {
    const contents = this.getContents();
    if (contents && !contents.isDestroyed()) contents.send(IPC_CHANNELS.streamStatus, status);
  }
}

import type { NdiHostCommand } from './ndi-host-protocol';

const MAX_RECEIVERS = 8;
// Keep native receive polls nonblocking. The renderer backs off 8ms on null
// frames, so offline sources don't occupy the addon worker pool while waiting.
const MAX_RECEIVE_WAIT_MS = 0;

export type NdiNativeApi = Pick<
  typeof import('@lumacast/ndi-native'),
  | 'discoverSources'
  | 'createReceiver'
  | 'receiveFrame'
  | 'destroyReceiver'
  | 'initializeSender'
  | 'sendRgbaFrame'
  | 'sendAudioFrame'
  | 'destroySender'
>;

export function createNdiHostRuntime(loadNative: () => NdiNativeApi) {
  let native: NdiNativeApi | null = null;
  const receivers = new Set<string>();
  const senders = new Set<string>();
  const getNative = () => native ??= loadNative();

  async function handle(command: NdiHostCommand): Promise<unknown> {
    switch (command.type) {
      case 'discover':
        return getNative().discoverSources(2000);
      case 'startReceive': {
        if (receivers.size >= MAX_RECEIVERS) throw new Error('LumaStream supports up to eight NDI receivers at a time.');
        const receiverId = await getNative().createReceiver(command.source, { includeAudio: command.includeAudio });
        receivers.add(receiverId);
        return receiverId;
      }
      case 'readFrame': {
        if (!receivers.has(command.receiverId)) throw new Error('The NDI receiver is no longer active.');
        return await getNative().receiveFrame(command.receiverId, MAX_RECEIVE_WAIT_MS);
      }
      case 'stopReceive': {
        if (!receivers.has(command.receiverId)) return undefined;
        await getNative().destroyReceiver(command.receiverId);
        receivers.delete(command.receiverId);
        return undefined;
      }
      case 'startSend': {
        if (senders.size > 0) throw new Error('LumaStream supports one NDI sender at a time.');
        const senderName = command.settings.senderName;
        getNative().initializeSender({ ...command.settings, withAlpha: false });
        senders.add(senderName);
        return senderName;
      }
      case 'sendVideo':
        if (!senders.has(command.senderName)) throw new Error('The NDI sender is no longer active.');
        getNative().sendRgbaFrame(command.senderName, command.data, command.width, command.height);
        return undefined;
      case 'sendAudio':
        if (!senders.has(command.senderName)) throw new Error('The NDI sender is no longer active.');
        getNative().sendAudioFrame(command.senderName, command.data, command.sampleRate, command.channels, command.samplesPerChannel);
        return undefined;
      case 'stopSend':
        if (!senders.has(command.senderName)) return undefined;
        getNative().destroySender(command.senderName);
        senders.delete(command.senderName);
        return undefined;
      case 'destroy': {
        const api = native;
        if (api) {
          await Promise.allSettled([...receivers].map((receiverId) => api.destroyReceiver(receiverId)));
          for (const senderName of senders) {
            try { api.destroySender(senderName); } catch { /* The utility process will be torn down by main. */ }
          }
        }
        receivers.clear();
        senders.clear();
        return undefined;
      }
    }
  }

  return { handle };
}

export function loadNdiNative(): NdiNativeApi {
  return require('@lumacast/ndi-native') as NdiNativeApi;
}

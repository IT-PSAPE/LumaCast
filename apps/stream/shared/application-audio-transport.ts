/** Interleaved stereo float32 at 48 kHz. Queue bounds exclude stream/OS buffers. */
export const APPLICATION_AUDIO_FRAME_BYTES = 8;
export const APPLICATION_AUDIO_PACKET_BYTES = 7680;
export const APPLICATION_AUDIO_WINDOW_PACKETS = 5;
export const APPLICATION_AUDIO_PACKET_MS = 20;
export const APPLICATION_AUDIO_CONSUMPTION_MS = 250;
export const APPLICATION_AUDIO_READY_MS = 2000;

export type ApplicationAudioFrame = ArrayBuffer | { error: string };
/** True only after all samples have been consumed; false means the input closed. */
export type ApplicationAudioConsumer = (sourceId: string, frame: ApplicationAudioFrame) => Promise<boolean>;
export type ApplicationAudioPacket = { type: 'pcm'; sequence: number; buffer: ArrayBuffer } | { type: 'error'; error: string };

export function isApplicationAudioEpoch(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
}

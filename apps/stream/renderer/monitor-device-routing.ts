function sinkSetter(context: object): ((deviceId: string) => Promise<void>) | undefined {
  const candidate = (context as { setSinkId?: unknown }).setSinkId;
  return typeof candidate === 'function' ? candidate as (deviceId: string) => Promise<void> : undefined;
}

export function supportsAudioOutputSelection(context: object): boolean {
  return sinkSetter(context) !== undefined;
}

export async function routeMonitorToDevice(context: object, deviceId: string): Promise<void> {
  const setSinkId = sinkSetter(context);
  if (!setSinkId) {
    if (deviceId === '') return;
    throw new Error('Audio output device selection is unavailable.');
  }
  try {
    await setSinkId.call(context, deviceId);
  } catch (error) {
    if (deviceId !== '') await setSinkId.call(context, '').catch(() => undefined);
    throw error;
  }
}

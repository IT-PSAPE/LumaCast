import type { NdiHostCommand } from './ndi-host-protocol';

export function loadNative() {
  const command: NdiHostCommand = { requestId: '1', type: 'destroy' };
  return { native: require('@lumacast/ndi-native'), command };
}

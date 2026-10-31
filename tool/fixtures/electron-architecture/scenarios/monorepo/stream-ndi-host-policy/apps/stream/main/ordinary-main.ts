import type { NdiHostCommand } from './ndi-host-protocol';

export const command: NdiHostCommand = { requestId: '2', type: 'destroy' };
export const native = require('@lumacast/ndi-native');

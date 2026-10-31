import type { NdiHostCommand } from './ndi-host-protocol';

export function receive(command: NdiHostCommand) {
  return command.type;
}

// The process entry uses the runtime wrapper and does not load the native addon directly.
export const native = require('@lumacast/ndi-native');

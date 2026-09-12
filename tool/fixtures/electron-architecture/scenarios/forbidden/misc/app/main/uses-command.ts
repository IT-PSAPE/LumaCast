import type { NdiHostCommand } from './ndi/ndi-protocol';

export function bypass(): NdiHostCommand {
  return { type: 'frame' };
}
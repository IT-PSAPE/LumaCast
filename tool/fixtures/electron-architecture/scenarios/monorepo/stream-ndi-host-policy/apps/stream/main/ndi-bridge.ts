import type { NdiHostCommand } from './ndi-host-protocol';

export function post(command: NdiHostCommand) {
  return command;
}

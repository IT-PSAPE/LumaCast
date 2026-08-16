import type { NdiHostCommand } from './ndi-protocol';
import native from '@lumacast/ndi-native';

export class NdiServiceProxy {
  send(cmd: NdiHostCommand): void {
    native.send(cmd);
  }
}
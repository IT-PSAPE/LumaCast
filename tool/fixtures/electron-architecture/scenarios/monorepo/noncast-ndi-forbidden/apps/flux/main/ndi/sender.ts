// Forbidden: only apps/cast/main/ndi (and packages/engine) has an NDI engine
// session. In any other app this is ordinary main code.
import { createSender } from '@lumacast/ndi-native';
import type { NdiHostCommand } from '@lumacast/engine';

export type Command = NdiHostCommand;

export const sender = createSender;

// Permitted: main owns the Node-side photo packages and depends on the shared
// contract module.
import { imagingThing } from '@lumacast/photo-imaging';
import { libraryThing } from '@lumacast/photo-library';
import { DESKTOP_CHANNELS } from '../shared/desktop-api';

export const main = { imagingThing, libraryThing, channels: DESKTOP_CHANNELS };

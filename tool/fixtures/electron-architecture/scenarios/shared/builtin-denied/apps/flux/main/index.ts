// Permitted: main implements the contract and depends on it.
import { DESKTOP_CHANNELS } from '../shared/desktop-api';
import { imagingThing } from '@lumacast/photo-imaging';

export const mainEntry = { DESKTOP_CHANNELS, imagingThing };

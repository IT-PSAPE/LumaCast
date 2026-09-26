// Permitted: the renderer implements the contract and depends on it, and holds
// the renderer-safe photo domain model.
import { DESKTOP_CHANNELS } from '../shared/desktop-api';
import { photoModelThing } from '@lumacast/photo-model';

export const rendererEntry = { DESKTOP_CHANNELS, photoModelThing };

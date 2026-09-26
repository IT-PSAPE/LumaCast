// Forbidden: the split is not flux-local — no app's renderer may import a
// Node-side photo package.
import { libraryThing } from '@lumacast/photo-library';

export const root = { libraryThing };

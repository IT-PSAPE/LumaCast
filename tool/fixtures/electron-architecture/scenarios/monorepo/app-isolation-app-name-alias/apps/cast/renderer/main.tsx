// Forbidden: an app name is not a module specifier, and naming a real app
// that shares code belongs in a package instead.
import { thing } from '@lumacast/cloud';

export const root = thing;

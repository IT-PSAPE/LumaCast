// Forbidden: imaging may reach kernel and photo-model, not the library that
// sits above it.
import { kernelThing } from '@lumacast/kernel';
import { libraryThing } from '@lumacast/photo-library';

export const imagingThing = { kernelThing, libraryThing };

// Permitted: the library is the top of the photo stack — kernel, the domain
// model, and imaging, nothing else.
import { kernelThing } from '@lumacast/kernel';
import { photoModelThing } from '@lumacast/photo-model';
import { imagingThing } from '@lumacast/photo-imaging';

export const libraryThing = { kernelThing, photoModelThing, imagingThing };

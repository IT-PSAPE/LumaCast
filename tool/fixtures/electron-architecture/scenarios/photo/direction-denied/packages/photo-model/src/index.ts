// Forbidden: the domain model is the bottom of the photo stack. It may depend
// on kernel only, never on imaging or the library above it.
import { imagingThing } from '@lumacast/photo-imaging';

export const photoModelThing = { imagingThing };

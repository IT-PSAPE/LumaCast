// Forbidden: kernel depends on nothing (issue #219); it must not import
// composition.
import { compositionThing } from '@lumacast/composition';

export const kernelThing = compositionThing;

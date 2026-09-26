// Permitted: imaging sits above the domain model and kernel, and owns the
// Node-side decode/encode work the renderer never imports.
import { createReadStream } from 'node:fs';
import { kernelThing } from '@lumacast/kernel';
import { photoModelThing } from '@lumacast/photo-model';

export const imagingThing = { createReadStream, kernelThing, photoModelThing };

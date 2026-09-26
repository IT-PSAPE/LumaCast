// Permitted: photo-imaging is Node-side image code by design, so it may use
// Node builtins. Only the renderer-safe model is denied them.
import { readFileSync } from 'node:fs';
import { photoModelThing } from '@lumacast/photo-model';

export const imagingThing = { readFileSync, photoModelThing };

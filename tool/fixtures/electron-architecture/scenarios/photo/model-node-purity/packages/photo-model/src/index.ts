// Forbidden: photo-model is the one photo package a renderer may hold, so it
// must be usable in both processes. A Node builtin here would make the renderer
// depend on `node:fs` the moment it imports the model.
import { readFile } from 'node:fs';
import { existsSync } from 'fs';
import { kernelThing } from '@lumacast/kernel';

export const photoModelThing = { readFile, existsSync, kernelThing };

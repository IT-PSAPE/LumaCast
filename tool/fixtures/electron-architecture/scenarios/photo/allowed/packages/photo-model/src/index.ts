// Permitted: the photo domain model is pure data and depends on kernel only.
import { kernelThing } from '@lumacast/kernel';

export type PhotoRef = { id: string };

export const photoModelThing = { kernelThing };

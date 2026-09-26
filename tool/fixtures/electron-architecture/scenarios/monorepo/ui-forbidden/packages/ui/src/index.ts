// Forbidden: konva and electron stay out of @lumacast/ui (canvas owns konva),
// and ui depends on kernel only, so the shared visual layer cannot couple
// itself to a domain package.
import { Stage } from 'konva';
import { app } from 'electron';
import { compositionThing } from '@lumacast/composition';

export const uiThing = { Stage, app, compositionThing };

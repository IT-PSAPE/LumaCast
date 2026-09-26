// Permitted: the renderer holds the photo domain model, shared UI primitives,
// and the typed contract — never imaging or the library.
import { photoModelThing } from '@lumacast/photo-model';
import { uiThing } from '@lumacast/ui';
import type { DesktopApi } from '../shared/desktop-api';

export const root = { photoModelThing, uiThing } satisfies { api: DesktopApi };

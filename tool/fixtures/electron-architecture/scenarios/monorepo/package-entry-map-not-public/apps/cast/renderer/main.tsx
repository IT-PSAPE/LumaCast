// Forbidden: the export map names a second TypeScript file, but a package has
// exactly one public source entry (src/index.ts). An `exports` subpath cannot
// widen the public surface, so this deep import fails.
import { deepThing } from '@lumacast/widget/deep';

export const root = deepThing;

// Permitted: an app feature may import a shared package and its own app's
// UI primitives, addressed through the app-scoped @renderer alias.
import { kernelThing } from '@lumacast/kernel';
import { label } from '@renderer/utils/label';

export const castScene = { kernelThing, label };

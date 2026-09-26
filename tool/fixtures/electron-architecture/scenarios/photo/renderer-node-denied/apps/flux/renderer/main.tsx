// Forbidden: image decoding and the indexed library are Node-side work. The
// renderer reaches them over the typed IPC contract instead.
import { imagingThing } from '@lumacast/photo-imaging';

export const root = { imagingThing };

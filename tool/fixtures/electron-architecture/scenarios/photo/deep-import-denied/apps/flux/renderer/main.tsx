// Forbidden: the renderer may use the photo domain model, but only through the
// package's public entry point.
import { readMetadata } from '@lumacast/photo-model/src/internal/metadata';

export const root = { readMetadata };

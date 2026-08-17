// Forbidden: deep import into kernel's internals bypasses its public entry
// point (packages/kernel/src/index.ts).
import { createId } from '../../kernel/src/internal/id';

export const compositionThing = createId();

// Forbidden: a source deep import into a package always fails, published or
// not; only declared entry points are importable.
import { button } from '@lumacast/ui/src/internal/button';

export const root = button;

// Forbidden: the imaging and library packages are Node-side work. The
// specifiers here do not resolve to a file — one names a subpath that does not
// exist, the other names a package that is not installed at all — and the
// renderer is still denied, because the rule judges the package a specifier
// names, not only the file it happens to resolve to.
import { decode } from '@lumacast/photo-imaging/internal/decode';
import { openLibrary } from '@lumacast/photo-library';

export const root = { decode, openLibrary };

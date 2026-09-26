// Forbidden: a stylesheet is public only when `exports` names it by subpath.
// `style` and `unpkg` are bundler hints, not declarations of public API, so
// this import is a deep import like any other.
import '@lumacast/widget/theme.css';

export const root = 1;

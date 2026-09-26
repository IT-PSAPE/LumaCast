// Permitted: an app may use the shared UI package and its published
// stylesheet, exported by name in the package export map.
import { uiThing } from '@lumacast/ui';
import '@lumacast/ui/theme.css';

export const root = uiThing;

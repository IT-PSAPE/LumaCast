// Forbidden: a .cjs file is code too, so a package's purity rules apply to it.
import { legacy } from './legacy.cjs';

export const widgetThing = legacy;

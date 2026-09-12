// Domain primitive: project-level slide tag definitions.
import type { Id } from '@lumacast/kernel';

// Valid color keys for slide tags — these match the separator palette
// and are validated at the protocol boundary. Defined here as a shared
// package-safe constant so both the renderer and main process can
// reference the same allowed values without feature-to-feature imports.
export const SLIDE_TAG_COLOR_KEYS = [
  'red',
  'orange',
  'amber',
  'blue',
  'indigo',
  'pink',
  'green',
  'gray',
  'crimson',
  'brown',
  'ochre',
  'navy',
  'violet',
  'magenta',
  'teal',
  'slate',
] as const;

export type SlideTagColorKey = (typeof SLIDE_TAG_COLOR_KEYS)[number];

export function isValidSlideTagColorKey(value: string): value is SlideTagColorKey {
  return SLIDE_TAG_COLOR_KEYS.includes(value as SlideTagColorKey);
}

export interface SlideTag {
  id: Id;
  name: string;
  colorKey: SlideTagColorKey;
  order: number;
  createdAt: string;
  updatedAt: string;
}

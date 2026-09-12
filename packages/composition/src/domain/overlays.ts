// Domain primitive (#153, split from app/core/types.ts): the overlay entity
// and its animation shape.
import type { Id } from '@lumacast/kernel';
import type { SlideBackground } from './slides';
import type { SlideElement } from './slide-elements';

export type OverlayType = 'image' | 'shape' | 'text' | 'video';

export interface OverlayAnimation {
  kind: 'none' | 'dissolve' | 'fade' | 'pulse';
  durationMs: number;
  autoClearDurationMs?: number | null;
}

export interface Overlay {
  id: Id;
  slideId: Id;
  name: string;
  enabled: boolean;
  /**
   * Position in the overlay list panel, dense and 0-based. Added with the
   * v28 `list-order-index` migration so the overlay list can be drag-
   * reordered like every other list panel; before that overlays were only
   * ever ordered by `createdAt`.
   */
  order: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  animation: OverlayAnimation;
  createdAt: string;
  updatedAt: string;
}

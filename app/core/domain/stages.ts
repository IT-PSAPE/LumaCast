// Domain primitive (#153, split from app/core/types.ts): the stage entity.
import type { Id } from './ids';
import type { SlideBackground } from './slides';
import type { SlideElement } from './slide-elements';

export interface Stage {
  id: Id;
  slideId: Id;
  name: string;
  width: number;
  height: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

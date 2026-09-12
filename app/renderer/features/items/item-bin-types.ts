import type { Id } from '@lumacast/kernel';
import type { ItemRef, Slide } from '@lumacast/composition';

export interface ItemLike {
  id: Id;
  title: string;
}

export interface ItemProps<T extends ItemLike> {
  item: T;
  itemRef: ItemRef;
  slides: Slide[];
  isSelected: boolean;
  isEditing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onOpen: (itemRef: ItemRef) => void;
  onRename: (itemRef: ItemRef, title: string) => void;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
}

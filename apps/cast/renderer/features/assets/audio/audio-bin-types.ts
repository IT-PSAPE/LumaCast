import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
import type { SelectionModifiers } from '@lumacast/selection';

export interface AudioRowProps {
  asset: MediaAsset;
  isActive: boolean;
  isResourceSelected?: boolean;
  onArm: (id: Id) => void;
  onSelectionClick?: (id: Id, modifiers: SelectionModifiers) => boolean;
  onContextMenuTarget?: (id: Id) => void;
  onDeleteResource?: (id: Id) => Promise<void> | void;
}

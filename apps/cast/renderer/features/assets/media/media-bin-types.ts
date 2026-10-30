import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
import type { SelectionModifiers } from '@lumacast/selection';

export interface MediaItemProps {
  asset: MediaAsset;
  isActive: boolean;
  isResourceSelected?: boolean;
  onAssignLayer: (id: Id) => void;
  onArmVideo: (id: Id) => void;
  onSelectionClick?: (id: Id, modifiers: SelectionModifiers) => boolean;
  onContextMenuTarget?: (id: Id) => void;
  onDeleteResource?: (id: Id) => Promise<void> | void;
}

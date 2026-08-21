import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';

export interface MediaItemProps {
  asset: MediaAsset;
  isActive: boolean;
  onAssignLayer: (id: Id) => void;
  onArmVideo: (id: Id) => void;
}

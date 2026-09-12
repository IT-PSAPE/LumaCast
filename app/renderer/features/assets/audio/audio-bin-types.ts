import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';

export interface AudioRowProps {
  asset: MediaAsset;
  isActive: boolean;
  onArm: (id: Id) => void;
}

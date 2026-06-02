import type { LucideIcon } from 'lucide-react';
import { Ban, Film, Image, Layers2, RectangleHorizontal, Volume2, Workflow, XCircle } from 'lucide-react';
import type { Cue, Id, MediaAsset } from '@core/types';

export const MACRO_ICON: LucideIcon = Workflow;

export function getCueIcon(cue: Cue, mediaAssets: Pick<MediaAsset, 'id' | 'type'>[]): LucideIcon {
  switch (cue.kind) {
    case 'overlay.activate':
      return Layers2;
    case 'stage.set':
      return RectangleHorizontal;
    case 'audio.arm':
      return Volume2;
    case 'video.arm':
      return Film;
    case 'mediaLayer.set': {
      const id = (cue.payload as { assetId?: Id }).assetId;
      const asset = mediaAssets.find((entry) => entry.id === id);
      return asset?.type === 'video' ? Film : Image;
    }
    case 'flow.lifecycle':
      return Ban;
    case 'overlay.clear':
    case 'overlay.clearAll':
    case 'stage.clear':
    case 'video.clear':
    case 'audio.clear':
    case 'layer.clear':
    case 'layer.clearAll':
    default:
      return XCircle;
  }
}

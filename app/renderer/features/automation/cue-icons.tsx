import type { ComponentProps } from 'react';
import { Ban, Film, Image, Layers2, RectangleHorizontal, Volume2, Workflow, XCircle } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
import type { Cue } from '@lumacast/automation';

type IconProps = Omit<ComponentProps<typeof XCircle>, 'ref'>;

export function MacroIcon(props: IconProps) {
  return <Workflow {...props} />;
}

export function CueIcon({
  cue,
  mediaAssets,
  ...props
}: IconProps & {
  cue: Cue;
  mediaAssets: Pick<MediaAsset, 'id' | 'type'>[];
}) {
  switch (cue.kind) {
    case 'overlay.activate':
      return <Layers2 {...props} />;
    case 'stage.set':
      return <RectangleHorizontal {...props} />;
    case 'audio.arm':
      return <Volume2 {...props} />;
    case 'video.arm':
      return <Film {...props} />;
    case 'mediaLayer.set': {
      const id = (cue.payload as { assetId?: Id }).assetId;
      const asset = mediaAssets.find((entry) => entry.id === id);
      return asset?.type === 'video' ? <Film {...props} /> : <Image {...props} />;
    }
    case 'flow.lifecycle':
      return <Ban {...props} />;
    case 'overlay.clear':
    case 'overlay.clearAll':
    case 'stage.clear':
    case 'video.clear':
    case 'audio.clear':
    case 'layer.clear':
    case 'layer.clearAll':
      return <XCircle {...props} />;
  }

  return renderUnhandledCueIcon(cue.kind, props);
}

function renderUnhandledCueIcon(_kind: never, props: IconProps) {
  return <XCircle {...props} />;
}

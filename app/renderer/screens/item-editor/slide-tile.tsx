import { ContextMenu } from '../../components/overlays/context-menu';
import { SlideTileBody, type SlideTileProps } from './slide-tile-body';

export function SlideTile({ slideId, scene, index, isActive, isLive, isEmpty, textPreview, onSelect }: SlideTileProps) {
  return (
    <ContextMenu.Root>
      <SlideTileBody
        slideId={slideId}
        scene={scene}
        index={index}
        isActive={isActive}
        isLive={isLive}
        isEmpty={isEmpty}
        textPreview={textPreview}
        onSelect={onSelect}
      />
    </ContextMenu.Root>
  );
}

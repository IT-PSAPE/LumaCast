import type { ItemRef, ItemType } from '@lumacast/composition';
import { FileText, Music, Presentation } from 'lucide-react';

interface ItemIconProps {
  entity: Pick<ItemRef, 'type'> | ItemType;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function ItemIcon({ entity, size = 14, strokeWidth = 1.75, className = '' }: ItemIconProps) {
  const entityType = typeof entity === 'string' ? entity : entity.type;

  if (entityType === 'lyric') {
    return <Music size={size} strokeWidth={strokeWidth} className={className} />;
  }
  if (entityType === 'talk') {
    return <FileText size={size} strokeWidth={strokeWidth} className={className} />;
  }

  return <Presentation size={size} strokeWidth={strokeWidth} className={className} />;
}

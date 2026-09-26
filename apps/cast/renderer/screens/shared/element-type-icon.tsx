import { Box, Film, Image, Square, Type } from 'lucide-react';
import type { SlideElement } from '@lumacast/composition';

export function ElementTypeIcon({ type }: { type: SlideElement['type'] }) {
  const className = 'text-tertiary';
  if (type === 'text') return <Type size={12} strokeWidth={2} className={className} />;
  if (type === 'shape') return <Square size={12} strokeWidth={2} className={className} />;
  if (type === 'image') return <Image size={12} strokeWidth={2} className={className} />;
  if (type === 'video') return <Film size={12} strokeWidth={2} className={className} />;
  return <Box size={12} strokeWidth={2} className={className} />;
}

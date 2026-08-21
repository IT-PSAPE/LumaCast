import type { NdiOutputName } from '@lumacast/protocol';
import type { ObsEventCategory } from './metrics-store';

export const OUTPUT_TITLES: Record<NdiOutputName, string> = {
  audience: 'Audience',
  stage: 'Stage',
};

export const CATEGORY_FILTERS: Array<{ id: 'all' | ObsEventCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ndi', label: 'NDI' },
  { id: 'layer', label: 'Layers' },
  { id: 'overlay', label: 'Overlays' },
  { id: 'slide', label: 'Slides' },
  { id: 'playback', label: 'Playback' },
  { id: 'system', label: 'System' },
  { id: 'error', label: 'Errors' },
];

export const LEVEL_FILTERS: Array<{ id: 'all' | 'INFO' | 'WARN' | 'ERROR'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'INFO', label: 'Info' },
  { id: 'WARN', label: 'Warn' },
  { id: 'ERROR', label: 'Error' },
];

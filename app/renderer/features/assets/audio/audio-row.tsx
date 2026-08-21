import { ContextMenu } from '../../../components/overlays/context-menu';
import type { AudioRowProps } from './audio-bin-types';
import { AudioRowBody } from './audio-row-body';

export function AudioRow(props: AudioRowProps) {
  return (
    <ContextMenu.Root>
      <AudioRowBody {...props} />
    </ContextMenu.Root>
  );
}

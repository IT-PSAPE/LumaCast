import { Tabs } from '../../components/display/tabs';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';

export function PlaylistTabItem({ items }: { items: PlaylistDeckSequenceItem[] }) {
  const { currentPlaylistEntryId } = useNavigation();
  const { selectPlaylistEntry } = useSlides();

  function getLabel(item: PlaylistDeckSequenceItem) {
    const duplicateSuffix = item.occurrenceIndex > 1 ? ` (${item.occurrenceIndex})` : '';
    return `${item.item.title}${duplicateSuffix}`;
  }

  return (
    <Tabs.Root value={currentPlaylistEntryId ?? undefined} onValueChange={selectPlaylistEntry}>
      <Tabs.List label="Playlist items">
        {items.map((item) => <Tabs.Trigger value={item.entryId}>{getLabel(item)}</Tabs.Trigger>)}
      </Tabs.List>
    </Tabs.Root>
  );
}

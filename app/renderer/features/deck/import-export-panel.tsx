import { useMemo, useState } from 'react';
import type { DeckItem, Id, LibraryPlaylistBundle, Playlist } from '@core/types';
import { Check, ChevronDown, ListMusic, Search } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { Accordion } from '@renderer/components/display/accordion';
import { DeckItemIcon } from '@renderer/components/display/entity-icon';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SelectableRow } from '@renderer/components/display/selectable-row';
import { Tabs } from '@renderer/components/display/tabs';
import { Checkbox } from '@renderer/components/form/checkbox';
import { useCast } from '@renderer/contexts/app-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { BrokenReferenceReviewList } from './broken-reference-review-list';
import { useDeckImportExport } from './use-deck-import-export';

type TransferTab = 'export' | 'import';

type Tally = { selected: number; total: number };

function tally(ids: Id[], selectedIds: ReadonlySet<Id>): Tally {
  let selected = 0;
  for (const id of ids) if (selectedIds.has(id)) selected += 1;
  return { selected, total: ids.length };
}

function aggregateState(t: Tally): 'all' | 'partial' | 'none' {
  if (t.total === 0 || t.selected === 0) return 'none';
  if (t.selected === t.total) return 'all';
  return 'partial';
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ImportExportPanel() {
  const [activeTab, setActiveTab] = useState<TransferTab>('export');
  const { state, actions } = useDeckImportExport();
  const { presentations, lyrics, deckItems, deckItemsById } = useProjectContent();
  const { snapshot } = useCast();

  const libraryBundles: LibraryPlaylistBundle[] = snapshot?.libraryBundles ?? [];
  const allDeckItemIds = useMemo(() => deckItems.map((item) => item.id), [deckItems]);

  const normalizedFilter = state.filterText.trim().toLowerCase();
  const matchesFilter = (item: DeckItem) => {
    if (!normalizedFilter) return true;
    return item.title.toLowerCase().includes(normalizedFilter)
      || item.type.toLowerCase().includes(normalizedFilter);
  };

  const filteredPresentations = useMemo(() => presentations.filter(matchesFilter), [presentations, normalizedFilter]);
  const filteredLyrics = useMemo(() => lyrics.filter(matchesFilter), [lyrics, normalizedFilter]);

  const presentationIds = filteredPresentations.map((item) => item.id);
  const lyricIds = filteredLyrics.map((item) => item.id);
  const presentationTally = tally(presentationIds, state.selectedIds);
  const lyricTally = tally(lyricIds, state.selectedIds);
  const workspaceTally = tally(allDeckItemIds, state.selectedIds);

  const selectionList: DeckItem[] = useMemo(() => {
    const seen: DeckItem[] = [];
    state.selectedIds.forEach((id) => {
      const item = deckItemsById.get(id);
      if (item) seen.push(item);
    });
    return seen.sort((left, right) => left.title.localeCompare(right.title));
  }, [state.selectedIds, deckItemsById]);

  const inspection = state.inspection;
  const hasInspection = inspection !== null;
  const canFinalizeImport = hasInspection && state.blockedImportReasons.length === 0 && !state.importInFlight;
  const hasSelection = state.selectedCount > 0;

  function setBucket(ids: Id[], next: boolean) {
    if (next) actions.addToSelection(ids);
    else actions.removeFromSelection(ids);
  }

  function handleExportWorkspace() {
    void actions.exportWorkspace();
  }

  function handleExportPlaylist(playlist: Playlist, ids: Id[]) {
    if (ids.length === 0) return;
    const slug = playlist.name.trim() || 'playlist';
    void actions.exportIds(ids, `cast-playlist-${slug}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <Tabs.Root value={activeTab} onValueChange={(value) => setActiveTab(value as TransferTab)}>
        <Tabs.List label="Import &amp; export" className="border-b border-primary">
          <Tabs.Trigger value="export">Export</Tabs.Trigger>
          <Tabs.Trigger value="import">Import</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      {activeTab === 'export' ? (
        <section className="flex flex-col gap-4">
          <p className="text-xs text-tertiary">
            Bundle decks, themes, and referenced media into a portable .cst file.
          </p>

          <div className="flex items-center justify-between gap-3 rounded border border-primary bg-tertiary/25 p-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm font-medium text-primary">Entire workspace</div>
              <div className="text-xs text-tertiary">
                {pluralize(allDeckItemIds.length, 'item', 'items')} · every presentation, lyric, playlist, theme, overlay, page layout and referenced media file.
              </div>
            </div>
            <ReacstButton onClick={handleExportWorkspace} disabled={state.exportInFlight}>
              {state.exportInFlight ? 'Exporting…' : 'Export workspace'}
            </ReacstButton>
          </div>

          <div className="flex flex-col gap-2 rounded border border-primary bg-tertiary/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-wide text-tertiary">Include extras</div>
              <span className="text-xs text-tertiary">Applies to scoped &amp; per-playlist exports</span>
            </div>
            <div className="flex flex-col gap-2">
              <Checkbox.Root checked={state.extras.includeAllThemes} onCheckedChange={(v) => actions.setExtraFlag('includeAllThemes', v)}>
                <Checkbox.Indicator />
                <Checkbox.Label>All themes (not just those used by selected items)</Checkbox.Label>
              </Checkbox.Root>
              <Checkbox.Root checked={state.extras.includeOverlays} onCheckedChange={(v) => actions.setExtraFlag('includeOverlays', v)}>
                <Checkbox.Indicator />
                <Checkbox.Label>Overlays</Checkbox.Label>
              </Checkbox.Root>
              <Checkbox.Root checked={state.extras.includeStages} onCheckedChange={(v) => actions.setExtraFlag('includeStages', v)}>
                <Checkbox.Indicator />
                <Checkbox.Label>Page layouts (stages)</Checkbox.Label>
              </Checkbox.Root>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs uppercase tracking-wide text-tertiary">Or pick a scope</div>
            <label className="flex h-8 w-full items-center gap-2 rounded bg-tertiary px-2 text-sm text-primary transition-colors focus-within:ring-1 focus-within:ring-brand">
              <Search size={14} className="shrink-0 text-tertiary" />
              <input
                type="text"
                value={state.filterText}
                onChange={(event) => actions.setFilterText(event.target.value)}
                placeholder="Filter presentations, lyrics, playlists"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-tertiary"
              />
            </label>
          </div>

          <Accordion type="multiple" defaultValue={['presentations']} className="flex flex-col gap-2">
            <BucketSection
              value="presentations"
              title="Presentations"
              tally={presentationTally}
              onToggle={(next) => setBucket(presentationIds, next)}
            >
              <ItemList
                items={filteredPresentations}
                selectedIds={state.selectedIds}
                onToggle={actions.toggleSelectedId}
                emptyMessage="No presentations match your filter."
              />
            </BucketSection>

            <BucketSection
              value="lyrics"
              title="Lyrics"
              tally={lyricTally}
              onToggle={(next) => setBucket(lyricIds, next)}
            >
              <ItemList
                items={filteredLyrics}
                selectedIds={state.selectedIds}
                onToggle={actions.toggleSelectedId}
                emptyMessage="No lyrics match your filter."
              />
            </BucketSection>

            <PlaylistsSection
              libraryBundles={libraryBundles}
              selectedIds={state.selectedIds}
              onSetBucket={setBucket}
              onToggle={actions.toggleSelectedId}
              onExportPlaylist={handleExportPlaylist}
              exportInFlight={state.exportInFlight}
            />
          </Accordion>

          <SelectionSummary
            workspaceTally={workspaceTally}
            selectionList={selectionList}
            onClear={actions.clearSelection}
            onExport={() => void actions.exportSelected()}
            exportInFlight={state.exportInFlight}
            hasSelection={hasSelection}
          />
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-tertiary">Inspect a .cst bundle before merging it into your workspace.</p>
            <div className="flex items-center gap-2">
              <ReacstButton variant="ghost" onClick={actions.clearImportReview} disabled={!hasInspection && !state.importPath}>Clear</ReacstButton>
              <ReacstButton onClick={() => void actions.chooseImportBundle()} disabled={state.importInFlight}>
                {state.importInFlight && !hasInspection ? 'Loading…' : 'Choose bundle…'}
              </ReacstButton>
            </div>
          </div>

          {!hasInspection ? (
            <EmptyState.Root className="rounded border border-dashed border-primary bg-tertiary/20 py-8">
              <EmptyState.Title>No bundle loaded</EmptyState.Title>
              <EmptyState.Description>
                Choose a .cst file to preview its items, themes, and media references before importing.
              </EmptyState.Description>
            </EmptyState.Root>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 rounded border border-primary bg-tertiary/25 p-3">
                <div className="truncate text-sm font-medium text-primary">{state.importPath}</div>
                <div className="text-xs text-tertiary">
                  {[
                    pluralize(inspection.itemCount, 'item', 'items'),
                    pluralize(inspection.themeCount, 'theme', 'themes'),
                    inspection.overlayCount > 0 ? pluralize(inspection.overlayCount, 'overlay', 'overlays') : null,
                    inspection.stageCount > 0 ? pluralize(inspection.stageCount, 'page layout', 'page layouts') : null,
                    pluralize(inspection.mediaReferenceCount, 'media reference', 'media references'),
                  ].filter(Boolean).join(', ')}
                </div>
              </div>

              {inspection.items.length > 0 ? (
                <div className="flex flex-col rounded border border-primary bg-tertiary/25">
                  {inspection.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 border-b border-primary/60 px-3 py-1.5 text-sm last:border-b-0">
                      <span className="truncate text-primary">{item.title}</span>
                      <span className="shrink-0 text-xs uppercase tracking-wide text-tertiary">
                        {item.type} · {pluralize(item.slideCount, 'slide', 'slides')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {inspection.brokenReferences.length > 0 ? (
                <BrokenReferenceReviewList
                  inspection={inspection}
                  decisionMap={state.decisionMap}
                  onActionChange={actions.setBrokenReferenceAction}
                  onChooseReplacement={actions.chooseReplacementPath}
                />
              ) : (
                <EmptyState.Root className="rounded border border-primary bg-tertiary/20 py-4">
                  <EmptyState.Description>No broken local media references in this bundle.</EmptyState.Description>
                </EmptyState.Root>
              )}

              {state.blockedImportReasons.length > 0 ? (
                <ul className="flex flex-col gap-1 rounded border border-primary bg-tertiary/25 p-3 text-xs text-tertiary">
                  {state.blockedImportReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              ) : null}

              <div className="flex justify-end">
                <ReacstButton onClick={() => void actions.finalizeImport()} disabled={!canFinalizeImport}>
                  {state.importInFlight && hasInspection ? 'Importing…' : `Import ${pluralize(inspection.itemCount, 'item', 'items')}`}
                </ReacstButton>
              </div>
            </div>
          )}
        </section>
      )}

      {state.message ? (
        <div className="rounded border border-primary bg-tertiary/25 px-3 py-2 text-sm text-secondary">
          {state.message}
        </div>
      ) : null}
    </div>
  );
}

function BucketSection({
  value,
  title,
  tally: counts,
  onToggle,
  children,
}: {
  value: string;
  title: string;
  tally: Tally;
  onToggle: (next: boolean) => void;
  children: React.ReactNode;
}) {
  const status = aggregateState(counts);
  const disabled = counts.total === 0;

  return (
    <Accordion.Item value={value} className="overflow-hidden rounded border border-primary bg-tertiary/15">
      <div className="flex items-center gap-2 px-2">
        <Checkbox.Root
          checked={status === 'all'}
          disabled={disabled}
          onCheckedChange={(checked) => onToggle(checked)}
          className="py-2"
        >
          <Checkbox.Indicator>
            {status === 'all' ? <Check size={11} strokeWidth={2.5} /> : null}
            {status === 'partial' ? <span className="block h-0.5 w-2 rounded bg-brand-700" /> : null}
          </Checkbox.Indicator>
        </Checkbox.Root>
        <Accordion.Trigger className="group flex flex-1 items-center justify-between gap-2 py-2 pr-2">
          <span className="text-sm font-medium text-primary">{title}</span>
          <span className="flex items-center gap-2 text-xs text-tertiary">
            <span>{counts.selected}/{counts.total}</span>
            <ChevronDown size={14} className="transition-transform group-data-[state=open]:rotate-180" />
          </span>
        </Accordion.Trigger>
      </div>
      <Accordion.Content className="border-t border-primary/60 bg-primary/30 p-2">
        {children}
      </Accordion.Content>
    </Accordion.Item>
  );
}

function ItemList({
  items,
  selectedIds,
  onToggle,
  emptyMessage,
}: {
  items: DeckItem[];
  selectedIds: ReadonlySet<Id>;
  onToggle: (id: Id) => void;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState.Root className="py-4">
        <EmptyState.Title>{emptyMessage}</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const checked = selectedIds.has(item.id);
        return (
          <SelectableRow.Root key={item.id} selected={checked} onClick={() => onToggle(item.id)}>
            <SelectableRow.Leading>
              <DeckItemIcon entity={item} size={14} strokeWidth={1.75} className="text-tertiary" />
            </SelectableRow.Leading>
            <SelectableRow.Label>{item.title}</SelectableRow.Label>
            <SelectableRow.Trailing>
              <span className="text-xs uppercase tracking-wide text-tertiary">{item.type}</span>
              {checked ? <Check size={12} strokeWidth={2.5} className="text-brand_solid" /> : null}
            </SelectableRow.Trailing>
          </SelectableRow.Root>
        );
      })}
    </div>
  );
}

function PlaylistsSection({
  libraryBundles,
  selectedIds,
  onSetBucket,
  onToggle,
  onExportPlaylist,
  exportInFlight,
}: {
  libraryBundles: LibraryPlaylistBundle[];
  selectedIds: ReadonlySet<Id>;
  onSetBucket: (ids: Id[], next: boolean) => void;
  onToggle: (id: Id) => void;
  onExportPlaylist: (playlist: Playlist, ids: Id[]) => void;
  exportInFlight: boolean;
}) {
  const playlists = libraryBundles.flatMap((bundle) => bundle.playlists);
  const playlistTally = useMemo(() => {
    const ids = playlists.flatMap((tree) => tree.segments.flatMap((segment) => segment.entries.map((entry) => entry.item.id)));
    return tally(Array.from(new Set(ids)), selectedIds);
  }, [playlists, selectedIds]);
  const status = aggregateState(playlistTally);

  function handleToggleAll(next: boolean) {
    const ids = playlists.flatMap((tree) => tree.segments.flatMap((segment) => segment.entries.map((entry) => entry.item.id)));
    onSetBucket(Array.from(new Set(ids)), next);
  }

  return (
    <Accordion.Item value="playlists" className="overflow-hidden rounded border border-primary bg-tertiary/15">
      <div className="flex items-center gap-2 px-2">
        <Checkbox.Root
          checked={status === 'all'}
          disabled={playlistTally.total === 0}
          onCheckedChange={handleToggleAll}
          className="py-2"
        >
          <Checkbox.Indicator>
            {status === 'all' ? <Check size={11} strokeWidth={2.5} /> : null}
            {status === 'partial' ? <span className="block h-0.5 w-2 rounded bg-brand-700" /> : null}
          </Checkbox.Indicator>
        </Checkbox.Root>
        <Accordion.Trigger className="group flex flex-1 items-center justify-between gap-2 py-2 pr-2">
          <span className="text-sm font-medium text-primary">Playlists</span>
          <span className="flex items-center gap-2 text-xs text-tertiary">
            <span>{playlistTally.selected}/{playlistTally.total}</span>
            <ChevronDown size={14} className="transition-transform group-data-[state=open]:rotate-180" />
          </span>
        </Accordion.Trigger>
      </div>
      <Accordion.Content className="border-t border-primary/60 bg-primary/30 p-2">
        {playlists.length === 0 ? (
          <EmptyState.Root className="py-4">
            <EmptyState.Title>No playlists yet</EmptyState.Title>
            <EmptyState.Description>Create a playlist in the library to export it here.</EmptyState.Description>
          </EmptyState.Root>
        ) : (
          <Accordion type="multiple" className="flex flex-col gap-1">
            {playlists.map((tree) => {
              const ids = Array.from(new Set(tree.segments.flatMap((segment) => segment.entries.map((entry) => entry.item.id))));
              const counts = tally(ids, selectedIds);
              const itemStatus = aggregateState(counts);
              const items = tree.segments.flatMap((segment) => segment.entries.map((entry) => entry.item));
              const uniqueItems: DeckItem[] = [];
              const seen = new Set<Id>();
              for (const item of items) {
                if (seen.has(item.id)) continue;
                seen.add(item.id);
                uniqueItems.push(item);
              }

              return (
                <Accordion.Item key={tree.playlist.id} value={tree.playlist.id} className="rounded border border-primary/60 bg-primary/40">
                  <div className="flex items-center gap-2 px-2">
                    <Checkbox.Root
                      checked={itemStatus === 'all'}
                      disabled={counts.total === 0}
                      onCheckedChange={(checked) => onSetBucket(ids, checked)}
                      className="py-1.5"
                    >
                      <Checkbox.Indicator>
                        {itemStatus === 'all' ? <Check size={11} strokeWidth={2.5} /> : null}
                        {itemStatus === 'partial' ? <span className="block h-0.5 w-2 rounded bg-brand-700" /> : null}
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    <Accordion.Trigger className="group flex flex-1 items-center justify-between gap-2 py-1.5 pr-2">
                      <span className="flex items-center gap-2 text-sm text-primary">
                        <ListMusic size={14} className="text-tertiary" />
                        {tree.playlist.name}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-tertiary">
                        <span>{counts.selected}/{counts.total}</span>
                        <ChevronDown size={14} className="transition-transform group-data-[state=open]:rotate-180" />
                      </span>
                    </Accordion.Trigger>
                    <ReacstButton
                      variant="ghost"
                      onClick={(event) => { event.stopPropagation(); onExportPlaylist(tree.playlist, ids); }}
                      disabled={ids.length === 0 || exportInFlight}
                    >
                      Export
                    </ReacstButton>
                  </div>
                  <Accordion.Content className="border-t border-primary/40 p-2">
                    <ItemList
                      items={uniqueItems}
                      selectedIds={selectedIds}
                      onToggle={onToggle}
                      emptyMessage="This playlist has no items."
                    />
                  </Accordion.Content>
                </Accordion.Item>
              );
            })}
          </Accordion>
        )}
      </Accordion.Content>
    </Accordion.Item>
  );
}

function SelectionSummary({
  workspaceTally,
  selectionList,
  onClear,
  onExport,
  exportInFlight,
  hasSelection,
}: {
  workspaceTally: Tally;
  selectionList: DeckItem[];
  onClear: () => void;
  onExport: () => void;
  exportInFlight: boolean;
  hasSelection: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-primary bg-tertiary/25 px-3 py-2">
      <div className="flex flex-col gap-0.5 text-xs text-tertiary">
        <span className="text-sm text-primary">
          {workspaceTally.selected === 0 ? 'No items selected' : `${workspaceTally.selected} of ${workspaceTally.total} selected`}
        </span>
        {selectionList.length > 0 ? (
          <span className="truncate">{selectionList.slice(0, 3).map((item) => item.title).join(', ')}{selectionList.length > 3 ? `, +${selectionList.length - 3} more` : ''}</span>
        ) : (
          <span>Pick items above or use the workspace shortcut.</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ReacstButton variant="ghost" onClick={onClear} disabled={!hasSelection}>Clear</ReacstButton>
        <ReacstButton onClick={onExport} disabled={!hasSelection || exportInFlight}>
          {exportInFlight ? 'Exporting…' : `Export selected${hasSelection ? ` (${workspaceTally.selected})` : ''}`}
        </ReacstButton>
      </div>
    </div>
  );
}

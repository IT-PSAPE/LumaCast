import { useMemo, useState } from 'react';
import type { DeckItem, Id, LibraryPlaylistBundle, PlaylistTree } from '@core/types';
import { Check, ChevronDown, ListMusic, Search } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
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
type TypeFilter = 'all' | 'presentation' | 'lyric' | 'playlist';

interface ItemRow {
  kind: 'item';
  id: Id;
  title: string;
  item: DeckItem;
}

interface PlaylistRow {
  kind: 'playlist';
  id: Id;
  title: string;
  tree: PlaylistTree;
  itemCount: number;
}

type Row = ItemRow | PlaylistRow;

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ImportExportPanel() {
  const [activeTab, setActiveTab] = useState<TransferTab>('export');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { state, actions } = useDeckImportExport();
  const { deckItems } = useProjectContent();
  const { snapshot } = useCast();

  const libraryBundles: LibraryPlaylistBundle[] = snapshot?.libraryBundles ?? [];
  const playlistTrees = useMemo(() => libraryBundles.flatMap((bundle) => bundle.playlists), [libraryBundles]);

  const allRows: Row[] = useMemo(() => {
    const itemRows: ItemRow[] = deckItems.map((item) => ({ kind: 'item', id: item.id, title: item.title, item }));
    const playlistRows: PlaylistRow[] = playlistTrees.map((tree) => {
      const uniqueItemIds = new Set<Id>();
      for (const segment of tree.segments) {
        for (const entry of segment.entries) uniqueItemIds.add(entry.item.id);
      }
      return { kind: 'playlist', id: tree.playlist.id, title: tree.playlist.name, tree, itemCount: uniqueItemIds.size };
    });
    return [...playlistRows, ...itemRows];
  }, [deckItems, playlistTrees]);

  const normalizedFilter = state.filterText.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      if (typeFilter !== 'all') {
        if (typeFilter === 'playlist' && row.kind !== 'playlist') return false;
        if (typeFilter === 'presentation' && (row.kind !== 'item' || row.item.type !== 'presentation')) return false;
        if (typeFilter === 'lyric' && (row.kind !== 'item' || row.item.type !== 'lyric')) return false;
      }
      if (!normalizedFilter) return true;
      return row.title.toLowerCase().includes(normalizedFilter);
    });
  }, [allRows, normalizedFilter, typeFilter]);

  const inspection = state.inspection;
  const hasInspection = inspection !== null;
  const canFinalizeImport = hasInspection && state.blockedImportReasons.length === 0 && !state.importInFlight;
  const hasSelection = state.selectedCount > 0;

  function handleToggleRow(row: Row) {
    if (row.kind === 'item') actions.toggleItemId(row.id);
    else actions.togglePlaylistId(row.id);
  }

  function isRowSelected(row: Row): boolean {
    if (row.kind === 'item') return state.selectedItemIds.has(row.id);
    return state.selectedPlaylistIds.has(row.id);
  }

  const selectionPreview = useMemo(() => {
    const titles: string[] = [];
    for (const tree of playlistTrees) {
      if (state.selectedPlaylistIds.has(tree.playlist.id)) titles.push(tree.playlist.name);
    }
    for (const item of deckItems) {
      if (state.selectedItemIds.has(item.id)) titles.push(item.title);
    }
    return titles;
  }, [deckItems, playlistTrees, state.selectedItemIds, state.selectedPlaylistIds]);

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
          <WorkspaceCard
            itemCount={deckItems.length}
            playlistCount={playlistTrees.length}
            onExport={() => void actions.exportWorkspace()}
            disabled={state.exportInFlight}
            inFlight={state.exportInFlight}
          />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-wide text-tertiary">Or pick what to export</div>
              <SegmentedControl value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
                <SegmentedControl.Label value="all">All</SegmentedControl.Label>
                <SegmentedControl.Label value="playlist">Playlists</SegmentedControl.Label>
                <SegmentedControl.Label value="presentation">Presentations</SegmentedControl.Label>
                <SegmentedControl.Label value="lyric">Lyrics</SegmentedControl.Label>
              </SegmentedControl>
            </div>
            <label className="flex h-8 w-full items-center gap-2 rounded bg-tertiary px-2 text-sm text-primary transition-colors focus-within:ring-1 focus-within:ring-brand">
              <Search size={14} className="shrink-0 text-tertiary" />
              <input
                type="text"
                value={state.filterText}
                onChange={(event) => actions.setFilterText(event.target.value)}
                placeholder="Filter by name…"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-tertiary"
              />
            </label>

            <RowList
              rows={filteredRows}
              isSelected={isRowSelected}
              onToggle={handleToggleRow}
              emptyMessage={
                allRows.length === 0
                  ? 'Nothing to export yet — create a presentation, lyric, or playlist first.'
                  : 'Nothing matches your filter.'
              }
            />
          </div>

          <AdvancedDisclosure
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((current) => !current)}
            extras={state.extras}
            onChange={actions.setExtraFlag}
          />

          <SelectionFooter
            selectedCount={state.selectedCount}
            preview={selectionPreview}
            hasSelection={hasSelection}
            onClear={actions.clearSelection}
            onExport={() => void actions.exportSelected()}
            inFlight={state.exportInFlight}
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
                    inspection.playlistCount > 0 ? pluralize(inspection.playlistCount, 'playlist', 'playlists') : null,
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

              {inspection.playlists.length > 0 ? (
                <div className="flex flex-col rounded border border-primary bg-tertiary/25">
                  {inspection.playlists.map((playlist) => (
                    <div key={playlist.id} className="flex items-center justify-between gap-3 border-b border-primary/60 px-3 py-1.5 text-sm last:border-b-0">
                      <span className="flex items-center gap-2 truncate text-primary">
                        <ListMusic size={14} className="text-tertiary" />
                        {playlist.name}
                      </span>
                      <span className="shrink-0 text-xs uppercase tracking-wide text-tertiary">
                        playlist · {pluralize(playlist.entryCount, 'entry', 'entries')}
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

function WorkspaceCard({
  itemCount,
  playlistCount,
  onExport,
  disabled,
  inFlight,
}: {
  itemCount: number;
  playlistCount: number;
  onExport: () => void;
  disabled: boolean;
  inFlight: boolean;
}) {
  const summaryParts = [pluralize(itemCount, 'item', 'items')];
  if (playlistCount > 0) summaryParts.push(pluralize(playlistCount, 'playlist', 'playlists'));
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-primary bg-tertiary/25 p-3">
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-medium text-primary">Export entire workspace</div>
        <div className="text-xs text-tertiary">
          {summaryParts.join(' · ')} · includes themes, overlays, page layouts, and referenced media.
        </div>
      </div>
      <ReacstButton onClick={onExport} disabled={disabled}>
        {inFlight ? 'Exporting…' : 'Export workspace'}
      </ReacstButton>
    </div>
  );
}

function RowList({
  rows,
  isSelected,
  onToggle,
  emptyMessage,
}: {
  rows: Row[];
  isSelected: (row: Row) => boolean;
  onToggle: (row: Row) => void;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState.Root className="rounded border border-dashed border-primary bg-tertiary/15 py-8">
        <EmptyState.Title>{emptyMessage}</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto rounded border border-primary bg-tertiary/15 p-1">
      {rows.map((row) => (
        <SelectableRow.Root
          key={`${row.kind}:${row.id}`}
          selected={isSelected(row)}
          onClick={() => onToggle(row)}
        >
          <SelectableRow.Leading>
            {row.kind === 'playlist' ? (
              <ListMusic size={14} strokeWidth={1.75} className="text-tertiary" />
            ) : (
              <DeckItemIcon entity={row.item} size={14} strokeWidth={1.75} className="text-tertiary" />
            )}
          </SelectableRow.Leading>
          <SelectableRow.Label>{row.title}</SelectableRow.Label>
          <SelectableRow.Trailing>
            <span className="text-xs uppercase tracking-wide text-tertiary">
              {row.kind === 'playlist'
                ? `playlist · ${pluralize(row.itemCount, 'item', 'items')}`
                : row.item.type}
            </span>
            {isSelected(row) ? <Check size={12} strokeWidth={2.5} className="text-brand_solid" /> : null}
          </SelectableRow.Trailing>
        </SelectableRow.Root>
      ))}
    </div>
  );
}

function AdvancedDisclosure({
  open,
  onToggle,
  extras,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  extras: { includeAllThemes: boolean; includeOverlays: boolean; includeStages: boolean };
  onChange: (flag: 'includeAllThemes' | 'includeOverlays' | 'includeStages', value: boolean) => void;
}) {
  return (
    <div className="rounded border border-primary bg-tertiary/15">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs uppercase tracking-wide text-tertiary"
      >
        <span>Advanced</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-primary/60 px-3 py-2">
          <p className="text-xs text-tertiary">
            By default, only themes used by selected items are bundled. Toggle on to include unused workspace assets.
          </p>
          <Checkbox.Root checked={extras.includeAllThemes} onCheckedChange={(v) => onChange('includeAllThemes', v)}>
            <Checkbox.Indicator />
            <Checkbox.Label>Include all themes</Checkbox.Label>
          </Checkbox.Root>
          <Checkbox.Root checked={extras.includeOverlays} onCheckedChange={(v) => onChange('includeOverlays', v)}>
            <Checkbox.Indicator />
            <Checkbox.Label>Include overlays</Checkbox.Label>
          </Checkbox.Root>
          <Checkbox.Root checked={extras.includeStages} onCheckedChange={(v) => onChange('includeStages', v)}>
            <Checkbox.Indicator />
            <Checkbox.Label>Include page layouts (stages)</Checkbox.Label>
          </Checkbox.Root>
        </div>
      ) : null}
    </div>
  );
}

function SelectionFooter({
  selectedCount,
  preview,
  hasSelection,
  onClear,
  onExport,
  inFlight,
}: {
  selectedCount: number;
  preview: string[];
  hasSelection: boolean;
  onClear: () => void;
  onExport: () => void;
  inFlight: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-primary bg-tertiary/25 px-3 py-2">
      <div className="flex flex-col gap-0.5 text-xs text-tertiary">
        <span className="text-sm text-primary">
          {selectedCount === 0 ? 'Nothing selected' : `${selectedCount} selected`}
        </span>
        {preview.length > 0 ? (
          <span className="truncate">
            {preview.slice(0, 3).join(', ')}{preview.length > 3 ? `, +${preview.length - 3} more` : ''}
          </span>
        ) : (
          <span>Pick items or playlists above.</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ReacstButton variant="ghost" onClick={onClear} disabled={!hasSelection}>Clear</ReacstButton>
        <ReacstButton onClick={onExport} disabled={!hasSelection || inFlight}>
          {inFlight ? 'Exporting…' : `Export${hasSelection ? ` (${selectedCount})` : ''}`}
        </ReacstButton>
      </div>
    </div>
  );
}

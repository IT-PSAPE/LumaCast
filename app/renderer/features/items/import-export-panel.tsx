import { useMemo, useState } from 'react';
import { ListMusic, Search } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import { EmptyState } from '@renderer/components/display/empty-state';
import { Tabs } from '@renderer/components/display/tabs';
import { FieldIcon, FieldInput } from '@renderer/components/form/field';
import { BrokenReferenceReviewList } from './broken-reference-review-list';
import { useDeckImportExport } from './use-deck-import-export';
import { pluralize, type ItemRow, type PlaylistRow, type Row } from './import-export-shared';
import { WorkspaceCard } from './workspace-card';
import { RowList } from './row-list';
import { AdvancedDisclosure } from './advanced-disclosure';
import { SelectionFooter } from './selection-footer';

type TransferTab = 'export' | 'import';
type TypeFilter = 'all' | 'presentation' | 'lyric' | 'talk' | 'playlist';

export function ImportExportPanel() {
  const [activeTab, setActiveTab] = useState<TransferTab>('export');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { state, actions } = useDeckImportExport();

  const allRows: Row[] = useMemo(() => {
    const itemRows: ItemRow[] = state.items.map((item) => ({ kind: 'item', id: item.id, title: item.title, item }));
    const playlistRows: PlaylistRow[] = state.playlists.map((playlist) => ({ kind: 'playlist', id: playlist.id, title: playlist.name, playlist }));
    return [...playlistRows, ...itemRows];
  }, [state.items, state.playlists]);

  const normalizedFilter = state.filterText.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      if (typeFilter !== 'all') {
        if (typeFilter === 'playlist' && row.kind !== 'playlist') return false;
        if (typeFilter === 'presentation' && (row.kind !== 'item' || row.item.type !== 'presentation')) return false;
        if (typeFilter === 'lyric' && (row.kind !== 'item' || row.item.type !== 'lyric')) return false;
        if (typeFilter === 'talk' && (row.kind !== 'item' || row.item.type !== 'talk')) return false;
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
    for (const playlist of state.playlists) {
      if (state.selectedPlaylistIds.has(playlist.id)) titles.push(playlist.name);
    }
    for (const item of state.items) {
      if (state.selectedItemIds.has(item.id)) titles.push(item.title);
    }
    return titles;
  }, [state.items, state.playlists, state.selectedItemIds, state.selectedPlaylistIds]);

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
            itemCount={state.items.length}
            playlistCount={state.playlists.length}
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
                <SegmentedControl.Label value="talk">Talks</SegmentedControl.Label>
              </SegmentedControl>
            </div>
            <FieldInput
              value={state.filterText}
              onChange={actions.setFilterText}
              placeholder="Filter by name…"
              ariaLabel="Filter by name"
              wrapperClassName="h-8 px-2 focus-within:ring-1 focus-within:ring-brand"
              iconClassName="ml-0 mr-2 size-auto"
              inputClassName="pl-0 pr-0 placeholder:text-tertiary"
            >
              <FieldIcon><Search size={14} className="shrink-0 text-tertiary" /></FieldIcon>
            </FieldInput>

            <RowList
              rows={filteredRows}
              isSelected={isRowSelected}
              onToggle={handleToggleRow}
              emptyMessage={
                allRows.length === 0
                  ? 'Nothing to export yet — create a presentation, lyric, or talk first.'
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
                        {playlist.separatorCount > 0 ? `, ${pluralize(playlist.separatorCount, 'separator', 'separators')}` : ''}
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

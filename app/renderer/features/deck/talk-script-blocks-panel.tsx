import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Id } from '@core/types';
import { Label } from '@renderer/components/display/text';
import DocEditor, { type Block } from '../../components/form/doc-editor';
import { useCast } from '../../contexts/app-context';
import { useProjectContent } from '../../contexts/use-project-content';

interface TalkScriptBlocksPanelProps {
  slideId: Id;
}

interface KnownBlock {
  dbId: Id;
  content: string;
  order: number;
}

const SAVE_DEBOUNCE_MS = 350;

export function TalkScriptBlocksPanel({ slideId }: TalkScriptBlocksPanelProps) {
  const { mutatePatch } = useCast();
  const { talkScriptBlocksBySlideId } = useProjectContent();

  // Seed DocEditor only when the slide changes; once mounted, the editor
  // owns its block state and we sync diffs back to the DB on its onChange.
  const initialBlocks = useMemo<Block[] | undefined>(() => {
    const fromDb = talkScriptBlocksBySlideId.get(slideId) ?? [];
    if (fromDb.length === 0) return undefined;
    return fromDb.map((block) => ({ id: block.id, content: block.text }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId]);

  // Map of DocEditor block id → matching DB record. Existing blocks share
  // ids with the DB; blocks DocEditor invents (split/paste/Enter) start
  // unknown and gain a mapping when sync first creates them.
  const knownBlocksRef = useRef<Map<string, KnownBlock>>(new Map());
  useEffect(() => {
    const fromDb = talkScriptBlocksBySlideId.get(slideId) ?? [];
    knownBlocksRef.current = new Map(
      fromDb.map((block) => [block.id, { dbId: block.id, content: block.text, order: block.order }]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId]);

  const debounceRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const latestBlocksRef = useRef<Block[]>([]);

  const syncBlocks = useCallback(async (editorBlocks: Block[]) => {
    const known = knownBlocksRef.current;
    const seen = new Set<string>();

    for (let index = 0; index < editorBlocks.length; index += 1) {
      const block = editorBlocks[index];
      seen.add(block.id);
      const record = known.get(block.id);
      if (record) {
        if (record.content !== block.content) {
          await mutatePatch(() => window.castApi.updateTalkScriptBlock({
            id: record.dbId,
            text: block.content,
          }));
          record.content = block.content;
        }
        if (record.order !== index) {
          await mutatePatch(() => window.castApi.setTalkScriptBlockOrder({
            id: record.dbId,
            newOrder: index,
          }));
          record.order = index;
        }
        continue;
      }
      // Don't persist a block that's still empty — the DocEditor seeds an
      // empty block when no DB rows exist, and Enter creates blank blocks
      // that aren't worth a row until the user actually types into them.
      if (block.content === '') continue;
      const persistedIds = new Set(Array.from(known.values(), (entry) => entry.dbId));
      const snapshot = await mutatePatch(() => window.castApi.createTalkScriptBlock({
        slideId,
        text: block.content,
        order: index,
      }));
      const created = snapshot.talkScriptBlocks.find(
        (b) => b.slideId === slideId && !persistedIds.has(b.id),
      );
      if (created) {
        known.set(block.id, { dbId: created.id, content: block.content, order: index });
      }
    }

    for (const [editorId, record] of Array.from(known.entries())) {
      if (seen.has(editorId)) continue;
      await mutatePatch(() => window.castApi.deleteTalkScriptBlock(record.dbId));
      known.delete(editorId);
    }
  }, [mutatePatch, slideId]);

  const handleChange = useCallback((editorBlocks: Block[]) => {
    latestBlocksRef.current = editorBlocks;
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const snapshot = latestBlocksRef.current;
      queueRef.current = queueRef.current
        .then(() => syncBlocks(snapshot))
        .catch((error) => { console.error('[TalkScript] sync failed', error); });
    }, SAVE_DEBOUNCE_MS);
  }, [syncBlocks]);

  useEffect(() => () => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-secondary">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-primary px-3">
        <Label.xs className="mr-auto">Script blocks</Label.xs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl justify-center">
          <DocEditor key={slideId} initialBlocks={initialBlocks} onChange={handleChange} />
        </div>
      </div>
    </div>
  );
}

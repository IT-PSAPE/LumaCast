import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Cue, CueFailurePolicy, CueKind, CuePayload, Id, Macro, MacroCue } from '@core/types';
import { useAutomation } from '@renderer/features/automation/automation-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { createScreenContext } from '@renderer/contexts/create-screen-context';

// In-editor representation of a cue in the macro's sequence. Persisted rows
// have a stable cueId; freshly-added rows live as drafts (with no cueId) until
// the user picks a kind+target — at which point we ensureCue() and patch the
// link. We keep the local id stable across the lifecycle so React keys and
// drag-reorder work.
export interface MacroEditorCueRow {
  localId: string;
  link: MacroCue | null;
  draftKind: CueKind | null;
  draftPayload: CuePayload | null;
  draftFailurePolicy: CueFailurePolicy;
}

// Local pending state for the macro currently open in the editor. While the
// user has unsaved edits, this overrides the persisted Macro for display and
// hasPendingChanges comparison; on save we push it through updateMacro +
// setMacroCues and clear it back to null.
interface MacroEditorDraft {
  macroId: Id;
  name: string;
  description: string;
  rows: MacroEditorCueRow[];
}

interface MacroEditorScreenContextValue {
  state: {
    macros: Macro[];
    currentMacro: Macro | null;
    rows: MacroEditorCueRow[];
    selectedRowId: string | null;
    hasPendingChanges: boolean;
    isPushingChanges: boolean;
    pendingName: string;
    pendingDescription: string;
  };
  actions: {
    selectMacro: (id: Id | null) => void;
    selectRow: (rowId: string | null) => void;
    addCueDraft: () => void;
    deleteRow: (rowId: string) => void;
    reorderRows: (orderedIds: string[]) => void;
    updateRowKind: (rowId: string, kind: CueKind) => void;
    updateRowPayload: (rowId: string, payload: CuePayload) => void;
    updateRowFailurePolicy: (rowId: string, policy: CueFailurePolicy) => void;
    updateMacroName: (name: string) => void;
    updateMacroDescription: (description: string) => void;
    saveChanges: () => Promise<void>;
    deleteCurrentMacro: () => Promise<void>;
  };
}

const [MacroEditorScreenContextProvider, useMacroEditorScreen] = createScreenContext<MacroEditorScreenContextValue>('MacroEditorScreenContext');

function rowsFromMacro(macro: Macro): MacroEditorCueRow[] {
  return macro.cues
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((link) => ({
      localId: `link:${link.id}`,
      link,
      draftKind: null,
      draftPayload: null,
      draftFailurePolicy: link.cue.failurePolicy,
    }));
}

// Serialize a row to a comparison key. We don't care about localId — only the
// observable shape of the saved cue + its position.
function rowSignature(row: MacroEditorCueRow, index: number): string {
  if (row.link) {
    return `${index}|link|${row.link.cue.kind}|${JSON.stringify(row.link.cue.payload)}|${row.link.cue.failurePolicy}`;
  }
  return `${index}|draft|${row.draftKind ?? ''}|${JSON.stringify(row.draftPayload ?? null)}|${row.draftFailurePolicy}`;
}

function rowsSignature(rows: MacroEditorCueRow[]): string {
  return rows.map((row, index) => rowSignature(row, index)).join('::');
}

export function MacroEditorScreenProvider({ children }: { children: ReactNode }) {
  const {
    state: { macros, currentMacroId },
    actions: { setCurrentMacroId, updateMacroFields, deleteMacro, setMacroCues, ensureCue },
  } = useAutomation();
  const { overlays, mediaAssets, stages } = useProjectContent();
  const { state: { workbenchMode } } = useWorkbench();
  const [draft, setDraft] = useState<MacroEditorDraft | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [isPushingChanges, setIsPushingChanges] = useState(false);

  const currentMacro = useMemo(
    () => macros.find((macro) => macro.id === currentMacroId) ?? null,
    [macros, currentMacroId],
  );

  // The draft only applies when its macroId matches currentMacroId. If we
  // switch macros without saving, the draft for the previous macro is still
  // around — but it isn't merged into the current view (the auto-save effect
  // pushes it before currentMacroId changes).
  const activeDraft = draft && draft.macroId === currentMacro?.id ? draft : null;

  const rows = useMemo<MacroEditorCueRow[]>(() => {
    if (activeDraft) return activeDraft.rows;
    if (!currentMacro) return [];
    return rowsFromMacro(currentMacro);
  }, [activeDraft, currentMacro]);

  const pendingName = activeDraft?.name ?? currentMacro?.name ?? '';
  const pendingDescription = activeDraft?.description ?? currentMacro?.description ?? '';

  const hasPendingChanges = useMemo(() => {
    if (!activeDraft || !currentMacro) return false;
    if (activeDraft.name !== currentMacro.name) return true;
    if (activeDraft.description !== currentMacro.description) return true;
    return rowsSignature(activeDraft.rows) !== rowsSignature(rowsFromMacro(currentMacro));
  }, [activeDraft, currentMacro]);

  // Mirror state to refs so callbacks (and the auto-save effect) see the
  // latest values without re-creating on every keystroke.
  const draftRef = useRef<MacroEditorDraft | null>(null);
  draftRef.current = activeDraft;
  const currentMacroRef = useRef<Macro | null>(null);
  currentMacroRef.current = currentMacro;
  const hasPendingChangesRef = useRef(false);
  hasPendingChangesRef.current = hasPendingChanges;

  // Serialize save calls so two near-simultaneous push attempts (manual click
  // + auto-save on mode change) don't race the ensureCue + setMacroCues
  // round-trip.
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  // Mutate the draft, lazily creating one from the current macro on first
  // edit. Returns nothing — callers should not assume the new state is
  // observable synchronously.
  const mutateDraft = useCallback((mutate: (draft: MacroEditorDraft) => MacroEditorDraft) => {
    setDraft((prev) => {
      const macro = currentMacroRef.current;
      if (!macro) return prev;
      const base: MacroEditorDraft = prev && prev.macroId === macro.id
        ? prev
        : { macroId: macro.id, name: macro.name, description: macro.description, rows: rowsFromMacro(macro) };
      return mutate(base);
    });
  }, []);

  const saveDraft = useCallback(async (draftToSave: MacroEditorDraft) => {
    const run = async () => {
      setIsPushingChanges(true);
      try {
        // 1. Resolve every row to a (cueId, orderIndex). Drafts that aren't
        //    complete yet are skipped — they stay in-memory and remain
        //    "pending" until the user fills them in.
        const cuePayloads: Array<{ id?: Id; cueId: Id; orderIndex: number }> = [];
        for (let i = 0; i < draftToSave.rows.length; i++) {
          const row = draftToSave.rows[i];
          if (row.link) {
            cuePayloads.push({ id: row.link.id, cueId: row.link.cueId, orderIndex: i });
            continue;
          }
          const draftKind = row.draftKind;
          const draftPayload = row.draftPayload;
          if (!draftKind || !draftPayload || !hasCompletePayload(draftKind, draftPayload)) continue;
          const cue = await ensureCue({ kind: draftKind, payload: draftPayload, failurePolicy: row.draftFailurePolicy });
          cuePayloads.push({ cueId: cue.id, orderIndex: cuePayloads.length });
        }

        // 2. Push name/description first (cheap), then cues. updateMacro
        //    accepts both in one call, but our auto-load happens inside
        //    setMacroCues — running them serially keeps the snapshot fresh.
        const macro = currentMacroRef.current;
        const nameChanged = !macro || draftToSave.name.trim() !== macro.name;
        const descriptionChanged = !macro || draftToSave.description !== macro.description;
        if (nameChanged || descriptionChanged) {
          await updateMacroFields(draftToSave.macroId, {
            name: nameChanged ? draftToSave.name.trim() || macro?.name || 'Untitled macro' : undefined,
            description: descriptionChanged ? draftToSave.description : undefined,
          });
        }
        await setMacroCues(draftToSave.macroId, cuePayloads);
      } finally {
        setIsPushingChanges(false);
      }
    };
    const next = saveQueueRef.current.then(run, run);
    saveQueueRef.current = next.catch(() => undefined);
    await next;
  }, [ensureCue, setMacroCues, updateMacroFields]);

  // After a successful save, the macro's updatedAt advances. Snap the draft
  // back to null so the next render re-derives rows from the fresh persisted
  // macro (this also drops any partially-complete drafts that didn't make
  // it into cuePayloads — they remain pending until filled out).
  useEffect(() => {
    if (!activeDraft || !currentMacro) return;
    if (isPushingChanges) return;
    if (hasPendingChanges) return;
    // No diff anymore — drop the draft so persisted state takes over.
    setDraft(null);
  }, [activeDraft, currentMacro, hasPendingChanges, isPushingChanges]);

  // Auto-save on workbench mode change. The previous-mode ref lets us detect
  // the transition AWAY from macro-editor (vs. the initial mount).
  const previousWorkbenchModeRef = useRef(workbenchMode);
  useEffect(() => {
    const previous = previousWorkbenchModeRef.current;
    previousWorkbenchModeRef.current = workbenchMode;
    if (previous !== 'macro-editor' || workbenchMode === 'macro-editor') return;
    if (!hasPendingChangesRef.current || !draftRef.current) return;
    void saveDraft(draftRef.current);
  }, [workbenchMode, saveDraft]);

  const selectMacro = useCallback((id: Id | null) => {
    // Auto-save the outgoing macro's pending draft before switching. Without
    // this, the staged edits would be silently dropped when we change
    // currentMacroId.
    const pending = draftRef.current;
    if (pending && hasPendingChangesRef.current) {
      void saveDraft(pending);
    }
    setCurrentMacroId(id);
    setSelectedRowId(null);
  }, [saveDraft, setCurrentMacroId]);

  const selectRow = useCallback((rowId: string | null) => {
    setSelectedRowId(rowId);
  }, []);

  const addCueDraft = useCallback(() => {
    const localId = `draft:${Math.random().toString(36).slice(2, 10)}`;
    mutateDraft((current) => ({
      ...current,
      rows: [...current.rows, {
        localId,
        link: null,
        draftKind: null,
        draftPayload: null,
        draftFailurePolicy: 'continue',
      }],
    }));
    setSelectedRowId(localId);
  }, [mutateDraft]);

  const reorderRows = useCallback((orderedIds: string[]) => {
    mutateDraft((current) => {
      const byId = new Map(current.rows.map((row) => [row.localId, row]));
      const next: MacroEditorCueRow[] = [];
      for (const id of orderedIds) {
        const row = byId.get(id);
        if (row) next.push(row);
      }
      return { ...current, rows: next };
    });
  }, [mutateDraft]);

  const deleteRow = useCallback((rowId: string) => {
    if (rowId === selectedRowId) setSelectedRowId(null);
    mutateDraft((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.localId !== rowId),
    }));
  }, [mutateDraft, selectedRowId]);

  const updateRowKind = useCallback((rowId: string, kind: CueKind) => {
    const nextPayload = defaultPayloadForKind(kind, { overlays, stages, mediaAssets });
    mutateDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.localId !== rowId) return row;
        // Persisted link: detach into a draft so the user can mutate it
        // freely. We finalize it via ensureCue at save time, which means the
        // original cue stays untouched until the user clicks Save (other
        // macros referencing the same cue keep working).
        return {
          ...row,
          link: null,
          draftKind: kind,
          draftPayload: nextPayload,
          draftFailurePolicy: row.link?.cue.failurePolicy ?? row.draftFailurePolicy,
        };
      }),
    }));
  }, [mediaAssets, mutateDraft, overlays, stages]);

  const updateRowPayload = useCallback((rowId: string, payload: CuePayload) => {
    mutateDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.localId !== rowId) return row;
        if (row.link) {
          // Detach the link into a draft so the payload edit doesn't try to
          // mutate the persisted cue in place.
          return {
            ...row,
            link: null,
            draftKind: row.link.cue.kind,
            draftPayload: payload,
            draftFailurePolicy: row.link.cue.failurePolicy,
          };
        }
        return { ...row, draftPayload: payload };
      }),
    }));
  }, [mutateDraft]);

  const updateRowFailurePolicy = useCallback((rowId: string, policy: CueFailurePolicy) => {
    mutateDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.localId !== rowId) return row;
        if (row.link) {
          return {
            ...row,
            link: null,
            draftKind: row.link.cue.kind,
            draftPayload: row.link.cue.payload,
            draftFailurePolicy: policy,
          };
        }
        return { ...row, draftFailurePolicy: policy };
      }),
    }));
  }, [mutateDraft]);

  const updateMacroName = useCallback((name: string) => {
    mutateDraft((current) => ({ ...current, name }));
  }, [mutateDraft]);

  const updateMacroDescription = useCallback((description: string) => {
    mutateDraft((current) => ({ ...current, description }));
  }, [mutateDraft]);

  const saveChanges = useCallback(async () => {
    const pending = draftRef.current;
    if (!pending || !hasPendingChangesRef.current) return;
    await saveDraft(pending);
  }, [saveDraft]);

  const deleteCurrentMacro = useCallback(async () => {
    if (!currentMacro) return;
    setDraft(null);
    setSelectedRowId(null);
    await deleteMacro(currentMacro.id);
  }, [currentMacro, deleteMacro]);

  const value = useMemo<MacroEditorScreenContextValue>(() => ({
    state: {
      macros,
      currentMacro,
      rows,
      selectedRowId,
      hasPendingChanges,
      isPushingChanges,
      pendingName,
      pendingDescription,
    },
    actions: {
      selectMacro,
      selectRow,
      addCueDraft,
      deleteRow,
      reorderRows,
      updateRowKind,
      updateRowPayload,
      updateRowFailurePolicy,
      updateMacroName,
      updateMacroDescription,
      saveChanges,
      deleteCurrentMacro,
    },
  }), [
    addCueDraft, currentMacro, deleteCurrentMacro, deleteRow, hasPendingChanges, isPushingChanges,
    macros, pendingDescription, pendingName, reorderRows, rows, saveChanges, selectMacro, selectRow,
    selectedRowId, updateMacroDescription, updateMacroName, updateRowFailurePolicy, updateRowKind,
    updateRowPayload,
  ]);

  return <MacroEditorScreenContextProvider value={value}>{children}</MacroEditorScreenContextProvider>;
}

export { useMacroEditorScreen };

// A draft is "complete" — and therefore safe to persist as a Cue — once its
// target identifier(s) are present. Kinds without a target (clearAll, etc.)
// are complete the moment their kind is picked.
export function hasCompletePayload(kind: CueKind, payload: CuePayload | null): payload is CuePayload {
  if (payload === null) return false;
  switch (kind) {
    case 'overlay.activate':
    case 'overlay.clear':
      return typeof (payload as { overlayId?: Id }).overlayId === 'string' && (payload as { overlayId: string }).overlayId.length > 0;
    case 'mediaLayer.set':
    case 'video.arm':
    case 'audio.arm':
      return typeof (payload as { assetId?: Id }).assetId === 'string' && (payload as { assetId: string }).assetId.length > 0;
    case 'stage.set':
      return typeof (payload as { stageId?: Id }).stageId === 'string' && (payload as { stageId: string }).stageId.length > 0;
    case 'layer.clear':
      return typeof (payload as { layer?: string }).layer === 'string';
    case 'flow.wait':
      return typeof (payload as { ms?: number }).ms === 'number';
    default:
      return true;
  }
}

export function defaultPayloadForKind(
  kind: CueKind,
  context: {
    overlays: Array<{ id: Id }>;
    stages: Array<{ id: Id }>;
    mediaAssets: Array<{ id: Id; type: string }>;
  },
): CuePayload {
  if (kind === 'overlay.activate' || kind === 'overlay.clear') return { overlayId: context.overlays[0]?.id ?? '' };
  if (kind === 'mediaLayer.set') return { assetId: context.mediaAssets.find((asset) => asset.type === 'image' || asset.type === 'video')?.id ?? '' };
  if (kind === 'video.arm') return { assetId: context.mediaAssets.find((asset) => asset.type === 'video')?.id ?? '' };
  if (kind === 'audio.arm') return { assetId: context.mediaAssets.find((asset) => asset.type === 'audio')?.id ?? '' };
  if (kind === 'stage.set') return { stageId: context.stages[0]?.id ?? '' };
  if (kind === 'layer.clear') return { layer: 'media' };
  if (kind === 'flow.wait') return { ms: 500 };
  return {} as CuePayload;
}

// Re-export the Cue type so the editor surface area is self-contained.
export type { Cue };

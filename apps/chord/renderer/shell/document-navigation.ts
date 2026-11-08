// User-facing document replacement policy. Store load/new/open remain trusted
// imperative primitives; menus and OS requests enter through this owner.
import { useEffect, useMemo, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { useToast } from '@lumacast/ui';
import type { ChordDesktopAPI } from '../../shared/desktop-api';
import type { ChordProject } from '../../shared/project';
import { getApi } from '../api';
import { confirmChoice } from '../components/confirm-dialog';
import { useChordStore } from '../store';
import type { ChordStore } from '../store/types';

interface NavigationDeps {
  api: ChordDesktopAPI;
  store: Pick<StoreApi<ChordStore>, 'getState' | 'subscribe'>;
  confirm: typeof confirmChoice;
  reportError: (message: string) => void;
}

interface Revision { session: number; project: ChordProject }
interface Action { kind: 'replace' | 'save' | 'close'; session: number; controller: AbortController }

export interface DocumentNavigationCommands {
  newDocument(): Promise<boolean>;
  openDocument(path?: string): Promise<boolean>;
  saveDocument(saveAs?: boolean): Promise<boolean>;
  closeDocument(): Promise<boolean>;
}

export function createDocumentNavigation({ api, store, confirm, reportError }: NavigationDeps) {
  let disposed = false;
  let active: Action | null = null;
  let pending: Promise<boolean> | null = null;
  // Keep this armed through the main-process drain, even if a different clean
  // document replaces the source. Its final unload must still be vetoed.
  let closeApproval: Revision | null = null;
  const revision = (): Revision => {
    const state = store.getState();
    return { session: state.getDocumentSession(), project: state.document.project };
  };
  const matches = (expected: Revision) => {
    const current = revision();
    return current.session === expected.session && current.project === expected.project;
  };
  const current = (action: Action) => !disposed && active === action
    && !action.controller.signal.aborted && store.getState().getDocumentSession() === action.session;
  const unsubscribe = store.subscribe((state) => {
    if (active && state.getDocumentSession() !== active.session) active.controller.abort();
  });
  // A cancellation is a main-process side effect too. A retired shell owner
  // may still finish its captured close drain, but cannot cancel an intent
  // now being handled by its mounted successor.
  const cancelNativeClose = () => disposed ? Promise.resolve(false) : api.requestWindowClose(false);

  async function protect(action: Action): Promise<Revision | null> {
    while (current(action)) {
      const source = revision();
      if (!store.getState().dirty) return source;
      const choice = await confirm('Save changes to this project?', [
        { value: 'discard', label: "Don't Save" },
        { value: 'cancel', label: 'Cancel' },
        { value: 'save', label: 'Save', variant: 'primary' },
      ], undefined, { signal: action.controller.signal });
      if (!current(action) || choice === null || choice === 'cancel') return null;
      if (!matches(source)) continue;
      if (choice === 'discard') return source;
      try { await store.getState().saveDocument(false); }
      catch {
        if (current(action)) reportError('Could not save this project.');
        return null;
      }
      if (!current(action) || store.getState().dirty) return null;
      return revision();
    }
    return null;
  }

  function run(kind: Action['kind'], operation: (action: Action) => Promise<boolean>): Promise<boolean> {
    if (disposed || active) return Promise.resolve(false);
    const action: Action = { kind, session: store.getState().getDocumentSession(), controller: new AbortController() };
    active = action;
    const result = Promise.resolve().then(async () => {
      try {
        if (!current(action)) {
          if (kind === 'close') await cancelNativeClose();
          return false;
        }
        return await operation(action);
      }
      catch {
        if (kind === 'close') await cancelNativeClose().catch(() => {});
        if (current(action)) reportError(kind === 'save' ? 'Could not save this project.' : kind === 'close' ? 'Could not close this window.' : 'Could not open this project.');
        return false;
      } finally {
        if (active === action) { active = null; pending = null; }
      }
    });
    pending = result;
    return result;
  }

  function replace(acquire: () => ReturnType<ChordDesktopAPI['openProject']>) {
    return run('replace', async (action) => {
      const candidate = await acquire();
      if (!candidate || !current(action)) return false;
      const approval = await protect(action);
      if (!approval || !current(action) || !matches(approval)) return false;
      store.getState().loadDocument(candidate);
      return true;
    });
  }

  const commands: DocumentNavigationCommands = {
    newDocument: () => replace(() => api.newProject()),
    openDocument: (path) => replace(() => api.openProject(path)),
    saveDocument: (saveAs) => run('save', async (action) => {
      await store.getState().saveDocument(saveAs);
      return current(action) && !store.getState().dirty;
    }),
    closeDocument: () => {
      if (disposed) return Promise.resolve(false);
      if (active) {
        // Repeated native close gestures must not cancel the first dialog.
        if (active.kind !== 'close') void cancelNativeClose().catch(() => {});
        return Promise.resolve(false);
      }
      return run('close', async (action) => {
        // Mounted-but-not-ready windows retry their captured cleanup through
        // this one user action, so failures have the same visible error path.
        await api.documentNavigationReady();
        if (!current(action)) { await cancelNativeClose(); return false; }
        while (current(action)) {
          const source = revision();
          if (store.getState().dirty) {
            const choice = await confirm('Save changes to this project before closing?', [
              { value: 'discard', label: "Don't Save" },
              { value: 'cancel', label: 'Cancel' },
              { value: 'save', label: 'Save', variant: 'primary' },
            ], undefined, { signal: action.controller.signal });
            if (!current(action) || choice === null || choice === 'cancel') {
              await cancelNativeClose();
              return false;
            }
            if (!matches(source)) continue;
            if (choice === 'save') {
              // Existing close behavior: Save keeps the window open.
              try { await store.getState().saveDocument(false); }
              catch { if (current(action)) reportError('Could not save this project.'); }
              finally { await cancelNativeClose(); }
              return false;
            }
          }
          closeApproval = source;
          try {
            const closed = await api.requestWindowClose(true);
            if (closed) return true;
            if (!current(action)) {
              await cancelNativeClose();
              return false;
            }
          } finally { closeApproval = null; }
          // A newer revision vetoed the replay after export cleanup. Protect
          // that revision before asking main to close again.
        }
        await cancelNativeClose();
        return false;
      });
    },
  };

  return {
    ...commands,
    beforeUnload(event: BeforeUnloadEvent) {
      if (disposed && !closeApproval) return;
      if (closeApproval && !disposed && matches(closeApproval)) return;
      if (closeApproval || store.getState().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
    dispose() {
      disposed = true;
      active?.controller.abort();
      unsubscribe();
      return closeApproval ? pending : null;
    },
  };
}

export function useDocumentNavigation(): DocumentNavigationCommands {
  const owner = useRef<ReturnType<typeof createDocumentNavigation> | null>(null);
  const { toast } = useToast();
  useEffect(() => {
    // useToast exposes the shared imperative API without React state.
    const navigation = createDocumentNavigation({ api: getApi(), store: useChordStore, confirm: confirmChoice,
      reportError: (message) => toast({ description: message, tone: 'error' }) });
    owner.current = navigation;
    window.addEventListener('beforeunload', navigation.beforeUnload);
    return () => {
      owner.current = null;
      const pending = navigation.dispose();
      const remove = () => window.removeEventListener('beforeunload', navigation.beforeUnload);
      // An in-flight close still needs its stale-owner veto until main has
      // finished replaying the close.
      if (pending) void pending.finally(remove); else remove();
    };
  }, [toast]);
  return useMemo(() => ({
    newDocument: () => owner.current?.newDocument() ?? Promise.resolve(false),
    openDocument: (path?: string) => owner.current?.openDocument(path) ?? Promise.resolve(false),
    saveDocument: (saveAs?: boolean) => owner.current?.saveDocument(saveAs) ?? Promise.resolve(false),
    closeDocument: () => owner.current?.closeDocument() ?? Promise.resolve(false),
  }), []);
}

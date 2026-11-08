import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { sceneEditorState, SceneHistory, type SceneEditorState } from '../../scene-history';
import { flattenSourceNodes } from '../../../shared/source-tree';
import type {
  SceneCollectionSummary, StreamAPI, StreamProfileSummary, StreamProject, StreamSource, StreamWorkspace,
} from '../../../shared/desktop-api';
import { friendlyError } from '../../shared/friendly-error';
import { WorkspaceAutosave } from './workspace-autosave';

export type WorkspaceDialogKind = 'new' | 'duplicate' | 'rename' | 'delete';

export interface UseWorkspaceParams {
  api: StreamAPI;
  setActionError: (message: string) => void;
  working: boolean;
  setWorking: (working: boolean) => void;
  /** True while recording, streaming, or the replay buffer is active — gates profile/collection switches. */
  isOutputActive: () => boolean;
  /** Tears down runtime/selection/dialog state owned by other features ahead of a scene-collection switch. */
  onWorkspaceChanging: () => void;
}

export interface UseWorkspaceResult {
  project: StreamProject | null;
  setProjectValue: (update: (current: StreamProject) => StreamProject) => void;
  allSources: StreamSource[];
  allSourcesRef: RefObject<StreamSource[]>;
  projectRef: RefObject<StreamProject | null>;
  loadingError: string;
  retryLoad: () => void;

  activeCollectionId: string | null;
  collections: SceneCollectionSummary[];
  activeCollection: SceneCollectionSummary | null;
  activeProfileId: string | null;
  profiles: StreamProfileSummary[];
  activeProfile: StreamProfileSummary | null;

  collectionDialog: WorkspaceDialogKind | null;
  setCollectionDialog: Dispatch<SetStateAction<WorkspaceDialogKind | null>>;
  profileDialog: WorkspaceDialogKind | null;
  setProfileDialog: Dispatch<SetStateAction<WorkspaceDialogKind | null>>;
  collectionNameDraft: string;
  setCollectionNameDraft: Dispatch<SetStateAction<string>>;
  profileNameDraft: string;
  setProfileNameDraft: Dispatch<SetStateAction<string>>;
  collectionError: string;
  profileError: string;

  openCollectionDialog: (kind: WorkspaceDialogKind) => void;
  openProfileDialog: (kind: WorkspaceDialogKind) => void;
  submitCollectionDialog: () => Promise<void>;
  submitProfileDialog: () => Promise<void>;
  activateCollection: (id: string) => Promise<void>;
  activateProfile: (id: string) => Promise<void>;
  importProfileFromFile: () => Promise<void>;
  importCollectionFromFile: () => Promise<void>;
  exportActiveCollection: () => Promise<void>;
  exportActiveProfile: () => Promise<void>;

  undoAvailable: boolean;
  redoAvailable: boolean;
  undoSceneEdit: () => void;
  redoSceneEdit: () => void;
}

/**
 * Project persistence (debounced save, initial load), scene collection and
 * profile state/dialogs/CRUD/import/export, and scene undo/redo history.
 */
export function useWorkspace(params: UseWorkspaceParams): UseWorkspaceResult {
  const { api, setActionError, working, setWorking, isOutputActive, onWorkspaceChanging } = params;

  const [project, setProject] = useState<StreamProject | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collections, setCollections] = useState<SceneCollectionSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<StreamProfileSummary[]>([]);
  const [collectionDialog, setCollectionDialog] = useState<WorkspaceDialogKind | null>(null);
  const [profileDialog, setProfileDialog] = useState<WorkspaceDialogKind | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [collectionError, setCollectionError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [loadingError, setLoadingError] = useState('');
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);

  const sceneHistoryRef = useRef<SceneHistory | null>(null);
  sceneHistoryRef.current ??= new SceneHistory();
  const sceneHistorySnapshotRef = useRef<SceneEditorState | null>(null);
  const sceneHistoryResetPendingRef = useRef(false);

  const allSources = useMemo(() => project?.scenes.flatMap((scene) => flattenSourceNodes(scene.sources)) ?? [], [project]);
  const allSourcesRef = useRef<StreamSource[]>([]);
  allSourcesRef.current = allSources;
  const projectRef = useRef<StreamProject | null>(null);
  const ownerRef = useRef<{ collectionId: string; profileId: string; project: StreamProject } | null>(null);
  const sessionRef = useRef(0);
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const workspaceChangingRef = useRef(false);
  const workspaceClosingRef = useRef(false);
  const closeRequestRef = useRef(0);
  const autosave = useMemo(() => new WorkspaceAutosave(api), [api]);
  const activeAutosaveRef = useRef(autosave);

  const replaceWorkspace = useCallback((workspace: StreamWorkspace) => {
    ownerRef.current = { collectionId: workspace.activeCollectionId, profileId: workspace.activeProfileId, project: workspace.project };
    projectRef.current = workspace.project;
    setActiveCollectionId(workspace.activeCollectionId);
    setCollections(workspace.collections);
    setActiveProfileId(workspace.activeProfileId);
    setProfiles(workspace.profiles);
    setProject(workspace.project);
  }, []);

  const retryLoad = useCallback(() => {
    if (ownerRef.current) return;
    const session = sessionRef.current;
    const request = ++loadRequestRef.current;
    setLoadingError('');
    void api.loadProject().then((workspace) => {
      if (!mountedRef.current || session !== sessionRef.current || request !== loadRequestRef.current) return;
      replaceWorkspace(workspace);
    }).catch((error) => {
      if (mountedRef.current && session === sessionRef.current && request === loadRequestRef.current) setLoadingError(friendlyError(error));
    });
  }, [api, replaceWorkspace]);

  const activeCollection = collections.find((collection) => collection.id === activeCollectionId) ?? null;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;

  useEffect(() => {
    mountedRef.current = true;
    activeAutosaveRef.current = autosave;
    ++sessionRef.current;
    workspaceChangingRef.current = false;
    workspaceClosingRef.current = false;
    ownerRef.current = null;
    projectRef.current = null;
    setProject(null);
    setActiveCollectionId(null);
    setActiveProfileId(null);
    sceneHistoryRef.current?.clear();
    sceneHistorySnapshotRef.current = null;
    setUndoAvailable(false);
    setRedoAvailable(false);
    retryLoad();
    return () => {
      mountedRef.current = false;
      ++loadRequestRef.current;
      ++closeRequestRef.current;
      // Native close/quit awaits the explicit flush below. Ordinary React
      // teardown still submits the last revision to its original API session.
      autosave.onError = null;
      void autosave.flush().catch(() => undefined);
    };
  }, [autosave, retryLoad]);

  useEffect(() => {
    const reportError = (error: unknown) => setActionError(`Could not save project settings: ${friendlyError(error)}`);
    autosave.onError = reportError;
    // Electron's main process owns graceful destruction. It either approves
    // native close/quit or reissues a reload after the same persistence gate.
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (typeof api.onProjectFlush === 'function') window.addEventListener('beforeunload', beforeUnload);
    const unsubscribe = api.onProjectFlush?.(async (closing) => {
      const request = ++closeRequestRef.current;
      workspaceClosingRef.current = closing;
      if (!closing) return;
      try { await autosave.flush(); }
      catch (error) {
        if (request === closeRequestRef.current) {
          workspaceClosingRef.current = false;
          reportError(error);
        }
        throw error;
      }
    });
    return () => {
      autosave.onError = null;
      unsubscribe?.();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [api, autosave, setActionError]);

  useEffect(() => {
    if (!project) return;
    const snapshot = sceneEditorState(project);
    const previous = sceneHistorySnapshotRef.current;
    sceneHistorySnapshotRef.current = snapshot;
    if (sceneHistoryResetPendingRef.current) sceneHistoryResetPendingRef.current = false;
    else if (previous && (previous.scenes !== snapshot.scenes || previous.activeSceneId !== snapshot.activeSceneId || previous.liveSceneId !== snapshot.liveSceneId || previous.sceneSwitchHotkeys !== snapshot.sceneSwitchHotkeys || previous.sourceVisibilityHotkeys !== snapshot.sourceVisibilityHotkeys)) {
      sceneHistoryRef.current?.record(previous, performance.now());
    }
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  }, [project?.scenes, project?.activeSceneId, project?.liveSceneId, project?.sceneSwitchHotkeys, project?.sourceVisibilityHotkeys]);

  const setProjectValue = useCallback((update: (current: StreamProject) => StreamProject) => {
    const owner = ownerRef.current;
    if (!mountedRef.current || activeAutosaveRef.current !== autosave || !owner || workspaceChangingRef.current || workspaceClosingRef.current) return;
    const next = update(owner.project);
    if (next === owner.project) return;
    ownerRef.current = { ...owner, project: next };
    projectRef.current = next;
    autosave.schedule(ownerRef.current);
    setProject(next);
  }, [autosave]);

  const resetSceneHistory = () => {
    sceneHistoryRef.current?.clear();
    sceneHistorySnapshotRef.current = null;
    sceneHistoryResetPendingRef.current = true;
    setUndoAvailable(false);
    setRedoAvailable(false);
  };

  const undoSceneEdit = () => {
    if (!project || workspaceChangingRef.current || workspaceClosingRef.current) return;
    const previous = sceneHistoryRef.current?.undo(sceneEditorState(project));
    if (!previous) return;
    sceneHistoryResetPendingRef.current = true;
    setProjectValue((current) => ({ ...current, ...previous }));
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  };

  const redoSceneEdit = () => {
    if (!project || workspaceChangingRef.current || workspaceClosingRef.current) return;
    const next = sceneHistoryRef.current?.redo(sceneEditorState(project));
    if (!next) return;
    sceneHistoryResetPendingRef.current = true;
    setProjectValue((current) => ({ ...current, ...next }));
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  };

  const applyWorkspace = (workspace: StreamWorkspace) => {
    resetSceneHistory();
    if (workspace.activeCollectionId !== activeCollectionId) {
      onWorkspaceChanging();
    }
    replaceWorkspace(workspace);
  };

  const changeWorkspace = async (operation: () => Promise<StreamWorkspace | null>, onError: (message: string) => void = setCollectionError): Promise<boolean> => {
    if (activeAutosaveRef.current !== autosave || !project || !activeCollectionId || !activeProfileId) return false;
    if (workspaceChangingRef.current || workspaceClosingRef.current) return false;
    if (working || isOutputActive()) {
      const message = 'Stop recording, streaming, and replay buffer before changing profiles or collections.';
      setActionError(message);
      onError(message);
      return false;
    }
    const session = sessionRef.current;
    const isCurrent = () => mountedRef.current && session === sessionRef.current;
    workspaceChangingRef.current = true;
    setWorking(true);
    setActionError('');
    try {
      await autosave.flush();
      if (!isCurrent() || workspaceClosingRef.current) return false;
      const workspace = await operation();
      if (!isCurrent() || !workspace) return false;
      applyWorkspace(workspace);
      return true;
    } catch (error) {
      if (isCurrent()) {
        const message = friendlyError(error);
        setActionError(`Workspace could not be changed: ${message}`);
        onError(message);
      }
      return false;
    } finally {
      if (isCurrent()) { workspaceChangingRef.current = false; setWorking(false); }
    }
  };

  const activateCollection = async (id: string) => {
    if (id === activeCollectionId) return;
    await changeWorkspace(() => api.activateCollection(id));
  };

  const activateProfile = async (id: string) => {
    if (id === activeProfileId) return;
    await changeWorkspace(() => api.activateProfile(id), setProfileError);
  };

  const submitCollectionDialog = async () => {
    if (!collectionDialog || !activeCollectionId || working) return;
    if (collectionDialog === 'rename') {
      const session = sessionRef.current;
      const isCurrent = () => mountedRef.current && session === sessionRef.current;
      setWorking(true);
      setActionError('');
      try {
        const next = await api.renameCollection(activeCollectionId, collectionNameDraft);
        if (!isCurrent()) return;
        setCollections(next);
        setCollectionDialog(null);
      } catch (error) {
        const message = friendlyError(error);
        if (isCurrent()) {
          setActionError(`Scene collection could not be renamed: ${message}`);
          setCollectionError(message);
        }
      } finally { if (isCurrent()) setWorking(false); }
      return;
    }
    if (collectionDialog === 'delete') {
      const changed = await changeWorkspace(() => api.deleteCollection(activeCollectionId));
      if (changed) setCollectionDialog(null);
      return;
    }
    const name = collectionNameDraft.trim();
    if (!name) return;
    const duplicateCurrent = collectionDialog === 'duplicate';
    const changed = await changeWorkspace(() => api.createCollection(name, duplicateCurrent));
    if (changed) setCollectionDialog(null);
  };

  const submitProfileDialog = async () => {
    if (!profileDialog || !activeProfileId || working) return;
    if (profileDialog === 'rename') {
      const session = sessionRef.current;
      const isCurrent = () => mountedRef.current && session === sessionRef.current;
      setWorking(true);
      setActionError('');
      try {
        const next = await api.renameProfile(activeProfileId, profileNameDraft);
        if (!isCurrent()) return;
        setProfiles(next);
        setProfileDialog(null);
      } catch (error) {
        const message = friendlyError(error);
        if (isCurrent()) {
          setActionError(`Profile could not be renamed: ${message}`);
          setProfileError(message);
        }
      } finally { if (isCurrent()) setWorking(false); }
      return;
    }
    if (profileDialog === 'delete') {
      const changed = await changeWorkspace(() => api.deleteProfile(activeProfileId), setProfileError);
      if (changed) setProfileDialog(null);
      return;
    }
    const name = profileNameDraft.trim();
    if (!name) return;
    const duplicateCurrent = profileDialog === 'duplicate';
    const changed = await changeWorkspace(() => api.createProfile(name, duplicateCurrent), setProfileError);
    if (changed) setProfileDialog(null);
  };

  const importProfileFromFile = async () => {
    setProfileError('');
    const changed = await changeWorkspace(() => api.importProfile(), setProfileError);
    if (changed) setProfileError('');
  };

  const importCollectionFromFile = async () => {
    setCollectionError('');
    const changed = await changeWorkspace(() => api.importCollection());
    if (changed) setCollectionError('');
  };

  const exportActiveCollection = async () => {
    if (!project || !activeCollectionId || !activeProfileId || working) return;
    const session = sessionRef.current;
    const isCurrent = () => mountedRef.current && session === sessionRef.current;
    setWorking(true);
    setActionError('');
    try {
      await autosave.flush();
      if (!isCurrent()) return;
      await api.exportCollection(activeCollectionId);
    } catch (error) {
      if (isCurrent()) setActionError(`Scene collection could not be exported: ${friendlyError(error)}`);
    } finally { if (isCurrent()) setWorking(false); }
  };

  const exportActiveProfile = async () => {
    if (!project || !activeCollectionId || !activeProfileId || working) return;
    const session = sessionRef.current;
    const isCurrent = () => mountedRef.current && session === sessionRef.current;
    setWorking(true);
    setActionError('');
    try {
      await autosave.flush();
      if (!isCurrent()) return;
      await api.exportProfile(activeProfileId);
    } catch (error) {
      if (isCurrent()) setActionError(`Profile could not be exported: ${friendlyError(error)}`);
    } finally { if (isCurrent()) setWorking(false); }
  };

  const openCollectionDialog = (kind: WorkspaceDialogKind) => {
    const currentName = activeCollection?.name ?? 'Scene Collection';
    setCollectionNameDraft(kind === 'rename' ? currentName : kind === 'duplicate' ? `${currentName} Copy`.slice(0, 80) : 'Scene Collection');
    setCollectionError('');
    setCollectionDialog(kind);
  };

  const openProfileDialog = (kind: WorkspaceDialogKind) => {
    const currentName = activeProfile?.name ?? 'Profile 1';
    setProfileNameDraft(kind === 'rename' ? currentName : kind === 'duplicate' ? `${currentName} Copy`.slice(0, 80) : 'Profile');
    setProfileError('');
    setProfileDialog(kind);
  };

  return {
    project, setProjectValue, allSources, allSourcesRef, projectRef, loadingError, retryLoad,
    activeCollectionId, collections, activeCollection, activeProfileId, profiles, activeProfile,
    collectionDialog, setCollectionDialog, profileDialog, setProfileDialog,
    collectionNameDraft, setCollectionNameDraft, profileNameDraft, setProfileNameDraft,
    collectionError, profileError,
    openCollectionDialog, openProfileDialog, submitCollectionDialog, submitProfileDialog,
    activateCollection, activateProfile, importProfileFromFile, importCollectionFromFile,
    exportActiveCollection, exportActiveProfile,
    undoAvailable, redoAvailable, undoSceneEdit, redoSceneEdit,
  };
}

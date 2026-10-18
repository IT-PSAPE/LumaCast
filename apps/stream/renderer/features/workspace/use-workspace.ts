import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { sceneEditorState, SceneHistory, type SceneEditorState } from '../../scene-history';
import { flattenSourceNodes } from '../../../shared/source-tree';
import type {
  SceneCollectionSummary, StreamAPI, StreamProfileSummary, StreamProject, StreamSource, StreamWorkspace,
} from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';

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
 * Mirrors the former inline App.tsx implementation exactly.
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
  projectRef.current = project;

  const activeCollection = collections.find((collection) => collection.id === activeCollectionId) ?? null;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;

  useEffect(() => {
    let active = true;
    void api.loadProject().then((workspace) => {
      if (!active) return;
      setActiveCollectionId(workspace.activeCollectionId);
      setCollections(workspace.collections);
      setActiveProfileId(workspace.activeProfileId);
      setProfiles(workspace.profiles);
      setProject(workspace.project);
    }).catch((error) => {
      if (active) setLoadingError(friendlyError(error));
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!project || !activeCollectionId || !activeProfileId) return;
    const timer = window.setTimeout(() => {
      void api.saveProject(activeCollectionId, activeProfileId, project).catch((error) => setActionError(`Could not save project settings: ${friendlyError(error)}`));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [api, activeCollectionId, activeProfileId, project, setActionError]);

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
    setProject((current) => current ? update(current) : current);
  }, []);

  const resetSceneHistory = () => {
    sceneHistoryRef.current?.clear();
    sceneHistorySnapshotRef.current = null;
    sceneHistoryResetPendingRef.current = true;
    setUndoAvailable(false);
    setRedoAvailable(false);
  };

  const undoSceneEdit = () => {
    if (!project) return;
    const previous = sceneHistoryRef.current?.undo(sceneEditorState(project));
    if (!previous) return;
    sceneHistoryResetPendingRef.current = true;
    setProject((current) => current ? { ...current, ...previous } : current);
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  };

  const redoSceneEdit = () => {
    if (!project) return;
    const next = sceneHistoryRef.current?.redo(sceneEditorState(project));
    if (!next) return;
    sceneHistoryResetPendingRef.current = true;
    setProject((current) => current ? { ...current, ...next } : current);
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  };

  const applyWorkspace = (workspace: StreamWorkspace) => {
    resetSceneHistory();
    if (workspace.activeCollectionId !== activeCollectionId) {
      onWorkspaceChanging();
    }
    setCollections(workspace.collections);
    setActiveCollectionId(workspace.activeCollectionId);
    setProfiles(workspace.profiles);
    setActiveProfileId(workspace.activeProfileId);
    setProject(workspace.project);
  };

  const changeWorkspace = async (operation: () => Promise<StreamWorkspace | null>, onError: (message: string) => void = setCollectionError): Promise<boolean> => {
    if (!project || !activeCollectionId || !activeProfileId) return false;
    if (working || isOutputActive()) {
      const message = 'Stop recording, streaming, and replay buffer before changing profiles or collections.';
      setActionError(message);
      onError(message);
      return false;
    }
    setWorking(true);
    setActionError('');
    try {
      await api.saveProject(activeCollectionId, activeProfileId, project);
      const workspace = await operation();
      if (!workspace) return false;
      applyWorkspace(workspace);
      return true;
    } catch (error) {
      const message = friendlyError(error);
      setActionError(`Workspace could not be changed: ${message}`);
      onError(message);
      return false;
    } finally { setWorking(false); }
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
      setWorking(true);
      setActionError('');
      try {
        const next = await api.renameCollection(activeCollectionId, collectionNameDraft);
        setCollections(next);
        setCollectionDialog(null);
      } catch (error) {
        const message = friendlyError(error);
        setActionError(`Scene collection could not be renamed: ${message}`);
        setCollectionError(message);
      } finally { setWorking(false); }
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
      setWorking(true);
      setActionError('');
      try {
        const next = await api.renameProfile(activeProfileId, profileNameDraft);
        setProfiles(next);
        setProfileDialog(null);
      } catch (error) {
        const message = friendlyError(error);
        setActionError(`Profile could not be renamed: ${message}`);
        setProfileError(message);
      } finally { setWorking(false); }
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
    setWorking(true);
    setActionError('');
    try {
      await api.saveProject(activeCollectionId, activeProfileId, project);
      await api.exportCollection(activeCollectionId);
    } catch (error) {
      setActionError(`Scene collection could not be exported: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const exportActiveProfile = async () => {
    if (!project || !activeCollectionId || !activeProfileId || working) return;
    setWorking(true);
    setActionError('');
    try {
      await api.saveProject(activeCollectionId, activeProfileId, project);
      await api.exportProfile(activeProfileId);
    } catch (error) {
      setActionError(`Profile could not be exported: ${friendlyError(error)}`);
    } finally { setWorking(false); }
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
    project, setProjectValue, allSources, allSourcesRef, projectRef, loadingError,
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

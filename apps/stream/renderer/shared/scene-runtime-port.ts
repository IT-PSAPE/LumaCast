import type { StreamSource } from '../../shared/desktop-api';

export interface SceneRuntimePair {
  source: StreamSource;
  duplicate: StreamSource;
}

export interface SceneRuntimeLease {
  commit(): void;
  rollback(): void;
}

/** Capture capability for copying active source runtimes into a duplicated scene. */
export interface SceneRuntimePort {
  duplicateSceneRuntimes(pairs: readonly SceneRuntimePair[]): Promise<SceneRuntimeLease>;
}

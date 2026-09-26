// The Lumaflux renderer's entire privileged surface, and the only module that
// both processes depend on. It is a contract boundary, not code: no Electron,
// no Node builtins, and no Node-side photo package may be named here, so the
// same shape is importable from main (which implements it over IPC) and from
// the renderer (which consumes `window.lumaflux`).
//
// `window.lumaflux` is the established global name and is deliberately
// unchanged: renaming it would orphan every existing renderer call site and any
// user script that reads the bridge. Photo metadata and edit types come from
// @lumacast/photo-model, which is renderer-safe by construction.
import type { AgentSettings, Recipe } from '@lumacast/photo-model';

export interface DesktopAPI {
  command: (name: string, args?: unknown) => Promise<any>;
  chooseImport: (folder?: boolean) => Promise<string[]>;
  chooseDirectory: () => Promise<string | null>;
  chooseRelink: () => Promise<string | null>;
  preview: (
    id: string,
    recipe?: Recipe,
    maxDimension?: number,
  ) => Promise<string>;
  assetUrl: (id: string, revision: number) => string;
  pathsForFiles: (files: File[]) => string[];
  onChange: (callback: () => void) => () => void;
  settings: () => Promise<AgentSettings>;
  updateSettings: (enabled: boolean, roots: string[]) => Promise<AgentSettings>;
}

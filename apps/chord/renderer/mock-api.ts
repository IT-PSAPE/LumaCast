// An in-memory stand-in for `window.lumachord`, used by the browser preview
// (no Electron main process to talk to) and by tests. Nothing here touches
// the filesystem: imports resolve to null urls/paths, exports are discarded,
// and there is never a "recent projects" list to show.
import { createId, nowIso } from '@lumacast/kernel';
import { createEmptyProject } from '../shared/project-schema';
import type {
  ChordDesktopAPI,
  ExportSink,
  ImportedFile,
} from '../shared/desktop-api';

export function createMockApi(): ChordDesktopAPI {
  let sinkSequence = 0;

  return {
    newProject: async () => ({ project: createEmptyProject(nowIso(), createId()), path: null }),
    openProject: async () => null,
    saveProject: async () => null,
    recentProjects: async () => [],
    setDocumentState: async () => {},

    importMedia: async () => null,
    admitFiles: async (): Promise<ImportedFile[]> => [],
    pathsForFiles: () => [],
    mediaUrl: async () => null,
    readCueFile: async () => '',

    exportCues: async () => null,

    chooseExportPath: async () => null,
    exportOpen: async (path): Promise<ExportSink> => ({ id: `mock-sink-${sinkSequence++}`, path }),
    exportWrite: async () => {},
    exportClose: async () => {},
    exportAbort: async () => {},
    revealPath: async () => {},

    onMenuCommand: () => () => {},
    onOpenDocument: () => () => {},
  };
}

// Forbidden: the typed IPC contract is a boundary. It describes the wire and
// must not import either implementation, the database, or the composition root.
import { mainEntry } from '../main/index';
import { rendererEntry } from '../renderer/entry';

export type DesktopApi = { mainEntry: typeof mainEntry; rendererEntry: typeof rendererEntry };

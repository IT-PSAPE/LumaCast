// Forbidden: main is the composition root and imports no renderer code —
// in any app, not just cast.
import { thing } from '../renderer/thing';

export const registerIpc = thing;

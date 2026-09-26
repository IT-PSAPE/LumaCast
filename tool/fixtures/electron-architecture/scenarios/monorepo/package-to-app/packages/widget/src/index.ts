// Forbidden: a package may not depend on an app, by relative path or by
// the app-scoped alias.
import { thing } from '../../../apps/cast/renderer/thing';

export const widgetThing = thing;

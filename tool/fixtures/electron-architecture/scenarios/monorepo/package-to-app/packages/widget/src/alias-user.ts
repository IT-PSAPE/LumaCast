// Forbidden: an app-scoped alias is not a way for a package to name an app.
import { thing } from '@renderer/components/does-not-exist';

export const used = thing;

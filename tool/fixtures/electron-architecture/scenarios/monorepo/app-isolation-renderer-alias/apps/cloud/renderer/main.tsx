// Forbidden: @renderer is app-scoped, so the cloud app resolving it into
// cast's tree is a cross-app import, not a local one.
import { thing } from '@renderer/components/thing';

export const root = thing;

// Forbidden twice over: `@renderer/...` resolves only inside the importing app,
// so this is an error in its own right. It must not be resolved into cast's
// tree, and the neighbouring app's file must not make it legal.
import { thing } from '@renderer/components/thing';
// Forbidden: this alias resolves in neither app, and an unresolved alias is
// still a violation rather than something to route to a package.
import { shared } from '@rendering/shared';

export const root = { thing, shared };

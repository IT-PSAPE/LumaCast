// Forbidden: naming an app as a module is the same violation as a relative
// path into it. Every app is covered, including one that ships no code yet —
// `apps/cloud` does not exist in this fixture, and the import still fails.
import { thing } from '@lumacast/cast/renderer/thing';
import { fluxThing } from '@lumacast/flux/renderer/thing';
import { cloudThing } from '@lumacast/cloud/renderer/thing';
import { fluxThing as workspaceFluxThing } from '@workspace/flux/renderer/thing';

export const widgetThing = { thing, fluxThing, cloudThing, workspaceFluxThing };

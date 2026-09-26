// Forbidden: apps are not addressable as modules, not even their own name.
import { thing } from '@workspace/cloud/renderer/thing';
import { ownThing } from '@workspace/cast/renderer/thing';

export const root = thing + ownThing;

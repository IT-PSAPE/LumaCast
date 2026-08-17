// Forbidden: a persistence package must never depend on the renderer.
import { ctx } from '../../../app/renderer/contexts/app-context';

export const persistenceThing = ctx;

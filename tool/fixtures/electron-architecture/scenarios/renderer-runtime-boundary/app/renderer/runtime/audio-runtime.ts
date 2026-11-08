import { appState } from '../contexts/app-context';
import { playback } from '../features/playback';
import { legacyRendererState } from '../legacy-renderer';

export const audioRuntimeDependencies = [appState, playback, legacyRendererState];

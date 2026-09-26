// Forbidden: the contract is imported by both the main and the renderer, so it
// must stay process-neutral — no Node builtins, no Electron, and none of the
// Node-side photo packages. Each of these would drag one process's runtime into
// the other the moment that side imported this file.
import { readFile } from 'node:fs';
import { resolve } from 'path';
import { app } from 'electron';
import { imagingThing } from '@lumacast/photo-imaging';

export type DesktopApi = { readFile: typeof readFile; resolve: typeof resolve; app: typeof app; imaging: typeof imagingThing };

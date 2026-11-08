import { createAppWindow } from '@lumacast/desktop';
import { defaultNdiModuleLoader } from '@lumacast/engine';
import { openProject } from '@lumacast/persistence-sqlite';

void [createAppWindow, defaultNdiModuleLoader, openProject];

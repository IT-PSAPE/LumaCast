// Forbidden: the photo packages are headless Node/domain code. React and
// Electron are out of scope for all of them, so no photo name is ever added to
// the react/konva allow lists.
import { useState } from 'react';
import { app } from 'electron';
import { kernelThing } from '@lumacast/kernel';

export const photoModelThing = { useState, app, kernelThing };

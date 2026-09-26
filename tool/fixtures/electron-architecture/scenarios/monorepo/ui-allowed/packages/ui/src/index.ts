// Permitted: @lumacast/ui is generic React controls, so react, react-dom
// and kernel are in bounds. It stays independent of any one app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { kernelThing } from '@lumacast/kernel';

export const uiThing = { useState, createRoot, kernelThing };

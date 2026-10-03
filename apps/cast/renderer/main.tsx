import React from 'react';
import { createRoot } from 'react-dom/client';
import { migrateLegacyRecastStorage, removeOrphanedLegacyStorage } from './utils/migrate-legacy-storage';
import './theme.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  if (new URLSearchParams(location.search).get('view') === 'ndi-output') {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.getElementById('root')!.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    const { NdiGpuView } = await import('./output/ndi-gpu-view');
    root.render(<NdiGpuView />);
    return;
  }
  migrateLegacyRecastStorage();
  removeOrphanedLegacyStorage();
  const { App } = await import('./App');
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
window.addEventListener('error', (event) => console.error('[Global error]', event.error));
window.addEventListener('unhandledrejection', (event) => console.error('[Unhandled rejection]', event.reason));
void start();

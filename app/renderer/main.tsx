import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { migrateLegacyRecastStorage } from './utils/migrate-legacy-storage';
import './theme.css';

migrateLegacyRecastStorage();

window.addEventListener('error', (event) => {
  console.error('[Global error]', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled rejection]', event.reason);
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

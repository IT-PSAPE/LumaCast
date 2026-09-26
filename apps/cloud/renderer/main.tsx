import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

// The shared palette switches on `[data-theme="dark"]`, and the App hook that
// keeps it in step with the OS only runs after the first render. Setting it
// here, before React mounts, means a dark-mode launch never paints a light
// first frame.
document.documentElement.setAttribute(
  'data-theme',
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
);

const container = document.getElementById('root');

if (container === null) {
  throw new Error('renderer root element not found');
}

createRoot(container).render(<App />);

import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('renderer root element not found');
}

createRoot(container).render(<App />);

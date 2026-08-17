// Permitted: the shell may import the composition root.
import { composeApp } from '../application/composition-root';

export function App(): number {
  return composeApp();
}

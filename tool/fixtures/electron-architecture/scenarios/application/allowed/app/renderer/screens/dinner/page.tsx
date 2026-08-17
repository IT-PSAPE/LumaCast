// Permitted: a screen may import the composition root.
import { composeApp } from '../../../application/composition-root';

export function DinnerPage(): number {
  return composeApp();
}

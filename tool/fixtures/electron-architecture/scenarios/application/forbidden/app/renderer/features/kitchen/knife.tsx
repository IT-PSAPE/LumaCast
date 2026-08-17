// Forbidden: only the shell and screens may import app/application.
import { compositionThing } from '../../../application/composition-root';

export function useKnife(): number {
  return compositionThing;
}

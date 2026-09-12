import { thing } from '../contracts/codec';

// Permitted: core may depend on the contracts decode boundary.
export function domain(): void {
  void thing;
}

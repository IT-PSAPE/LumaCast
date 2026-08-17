import { store } from '../database/store';

// Forbidden: contracts-purity — the decode boundary every zone depends on
// must not reach back into the database.
export const thing = 1;

export function useStore(): void {
  void store;
}

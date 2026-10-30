export type SelectionActionResult =
  | { ok: true }
  | { ok: false; failedId: string; remainingIds: string[]; error: unknown };

/** Run visible-order mutations sequentially and report the first failure. */
export async function runSelectionActions(
  ids: readonly string[],
  action: (id: string) => Promise<unknown> | unknown,
): Promise<SelectionActionResult> {
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    try {
      await action(id);
    } catch (error) {
      // Mutation owners report failures through their existing UI/error path.
      // Stop here so unattempted selected resources remain untouched.
      return { ok: false, failedId: id, remainingIds: ids.slice(index), error };
    }
  }
  return { ok: true };
}

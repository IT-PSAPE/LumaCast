export function filterByText<T>(
  items: T[],
  filterText: string,
  getFields: (item: T) => string[],
): T[] {
  const normalized = filterText.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => getFields(item).some((field) => field.toLowerCase().includes(normalized)));
}

/** LRU bounded by bytes, scoped to one renderer worker. Oversized entries bypass it. */
export class ByteCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private used = 0;
  constructor(private limit: number) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, bytes: number) {
    const previous = this.entries.get(key);
    if (previous) {
      this.used -= previous.bytes;
      this.entries.delete(key);
    }
    if (bytes > this.limit) return;
    this.entries.set(key, { value, bytes });
    this.used += bytes;
    while (this.used > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.used -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}

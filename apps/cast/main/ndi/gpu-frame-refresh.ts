/** A static Chromium scene can miss the first capture request during startup. */
export class GpuFrameRefresh {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private stopped = false;
  private lastKey: string | undefined;
  constructor(private readonly capture: () => void, private readonly timeout: () => void) {}
  get id(): number { return this.generation; }
  request(key?: string, force = false): void {
    if (this.stopped) return;
    // Keep the identity after acceptance/timeout so clock updates cannot
    // restart this retry window. Forced requests retain that same identity.
    if (!force && key !== undefined && key === this.lastKey) return;
    this.lastKey = key;
    this.cancel();
    const generation = ++this.generation;
    let remaining = 20;
    const refresh = () => {
      this.capture();
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.stopped || generation !== this.generation) return;
        if (--remaining > 0) refresh(); else this.timeout();
      }, 250);
    };
    refresh();
  }
  accept(id: number): void { if (id === this.generation) this.cancel(); }
  stop(): void { this.stopped = true; this.cancel(); }
  private cancel(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

/** A static Chromium scene can miss the first capture request during startup. */
export class GpuFrameRefresh {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private stopped = false;
  constructor(private readonly capture: () => void, private readonly timeout: () => void) {}
  get id(): number { return this.generation; }
  request(): void {
    if (this.stopped) return;
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

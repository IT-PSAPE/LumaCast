/** One active preview plus one replaceable pending preview prevents slider backlogs. */
export class LatestPreview<Input, Output> {
  private running = false;
  private pending?: {
    input: Input;
    resolve: (output: Output) => void;
    reject: (error: Error) => void;
  };
  constructor(private render: (input: Input) => Promise<Output>) {}
  request(input: Input): Promise<Output> {
    return new Promise((resolve, reject) => {
      if (this.pending)
        this.pending.reject(
          new Error("SUPERSEDED: A newer preview replaced this request"),
        );
      this.pending = { input, resolve, reject };
      void this.drain();
    });
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = undefined;
        try {
          job.resolve(await this.render(job.input));
        } catch (e) {
          job.reject(e as Error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

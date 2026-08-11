import type { DeferredTask, DeferredTasks } from "@guild/kernel";

export type NodeDeferredTasksOptions = Readonly<{
  concurrency: number;
  maxPending: number;
  onError: (error: unknown) => void | Promise<void>;
}>;

export class NodeDeferredTasks implements DeferredTasks {
  private readonly queue: DeferredTask[] = [];
  private readonly drainWaiters = new Set<() => void>();
  private active = 0;

  constructor(private readonly options: NodeDeferredTasksOptions) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
      throw new TypeError("Deferred task concurrency must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.maxPending) || options.maxPending < options.concurrency) {
      throw new TypeError("Deferred task maxPending must be at least its concurrency");
    }
  }

  defer(task: DeferredTask): void {
    if (this.active + this.queue.length >= this.options.maxPending) {
      this.reportError(new Error("Deferred task queue is full; task was dropped"));
      return;
    }
    this.queue.push(task);
    this.pump();
  }

  async drain(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.drainWaiters.add(resolve));
  }

  private pump(): void {
    while (this.active < this.options.concurrency) {
      const task = this.queue.shift();
      if (!task) break;
      this.active += 1;
      void Promise.resolve()
        .then(task)
        .catch((error: unknown) => this.reportError(error))
        .finally(() => {
          this.active -= 1;
          this.pump();
          if (this.active === 0 && this.queue.length === 0) {
            for (const resolve of this.drainWaiters) resolve();
            this.drainWaiters.clear();
          }
        });
    }
  }

  private reportError(error: unknown): void {
    try {
      const result = this.options.onError(error);
      if (result && typeof result.then === "function") {
        void Promise.resolve(result).catch((reportingError: unknown) => this.reportReporterFailure(reportingError, error));
      }
    } catch (reportingError) {
      this.reportReporterFailure(reportingError, error);
    }
  }

  private reportReporterFailure(reportingError: unknown, originalError: unknown): void {
    try {
      console.error("Deferred task error reporter failed", reportingError, { originalError });
    } catch {
      // Error reporting must never break a completed request.
    }
  }
}

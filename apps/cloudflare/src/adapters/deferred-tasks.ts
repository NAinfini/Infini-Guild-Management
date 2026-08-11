import type { DeferredTask, DeferredTasks } from "@guild/kernel";

export class CloudflareDeferredTasks implements DeferredTasks {
  constructor(private readonly executionContext: ExecutionContext) {}

  defer(task: DeferredTask): void {
    this.executionContext.waitUntil(Promise.resolve().then(task));
  }
}

import type { DeferredTask, DeferredTasks } from "@guild/kernel";

/*
 * 组合图按隔离区缓存，而 waitUntil 属于单个请求：这里只能持有取当前
 * ExecutionContext 的访问器，不能持有某一次请求的上下文本身。
 */
export class CloudflareDeferredTasks implements DeferredTasks {
  constructor(private readonly executionContext: () => ExecutionContext) {}

  defer(task: DeferredTask): void {
    this.executionContext().waitUntil(Promise.resolve().then(task));
  }
}

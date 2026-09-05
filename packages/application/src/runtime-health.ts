import type { BlobStore, RequestContext, SqlExecutor } from "@guild/kernel";
import type { RuntimeHealthPort, RuntimeHealthSnapshot } from "@guild/server";

export type RuntimeHealthDependencies = Readonly<{
  sql: SqlExecutor;
  blobs: BlobStore;
  realtime(): string;
  scheduler(): string;
}>;

export class ApplicationRuntimeHealth implements RuntimeHealthPort {
  constructor(private readonly dependencies: RuntimeHealthDependencies) {}

  async read(_context: RequestContext): Promise<RuntimeHealthSnapshot> {
    await Promise.all([
      // Database health requires the writer lane to respond even when readers still work.
      this.dependencies.sql.execute({ sql: "SELECT 1", method: "get" }),
      this.dependencies.blobs.head("health/probe"),
    ]);
    return {
      database: "ok",
      blob: "ok",
      realtime: boundedStatus(this.dependencies.realtime(), "realtime"),
      scheduler: boundedStatus(this.dependencies.scheduler(), "scheduler"),
    };
  }
}

function boundedStatus(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) throw new TypeError(`${name} health status is invalid`);
  return normalized;
}

import type { Bindings } from "../index";

export async function runErrorLogCleanupCron(env: Bindings): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM error_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
  ).run();
}

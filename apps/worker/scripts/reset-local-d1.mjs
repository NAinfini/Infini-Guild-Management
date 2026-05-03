import { rmSync } from "node:fs";
import { resolve } from "node:path";

const candidates = [
  resolve(process.cwd(), "apps/worker/.wrangler/state/v3/d1"),
];

const lockFailures = [];

for (const dir of candidates) {
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[db:mock:reset] removed ${dir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

    if (code === "EBUSY" || code === "EPERM") {
      lockFailures.push({ dir, message });
      console.error(`[db:mock:reset] locked ${dir}: ${message}`);
      continue;
    }

    console.warn(`[db:mock:reset] skip ${dir}: ${message}`);
  }
}

if (lockFailures.length > 0) {
  const lockedPaths = lockFailures.map((item) => item.dir).join(", ");
  throw new Error(
    `[db:mock:reset] failed because local D1 files are locked (${lockedPaths}). Stop all wrangler/workerd dev processes and retry.`,
  );
}

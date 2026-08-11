import { rm, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { FullResult, Reporter } from "@playwright/test/reporter";
import {
  ARTIFACTS_DIR,
  E2E_SLOTS,
  RUN_STATE_FILE,
  slotStateDirFor,
  stateFileFor,
  STATE_DIR,
} from "./config";

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
  }
}

async function cleanupManagedRunFiles(): Promise<void> {
  const removals = [
    rm(RUN_STATE_FILE, { force: true }),
    rm(resolve(ARTIFACTS_DIR, ".last-run.json"), { force: true }),
    ...Array.from({ length: E2E_SLOTS }, (_, slot) => [
      rm(stateFileFor("admin", slot), { force: true }),
      rm(slotStateDirFor(slot), { recursive: true, force: true }),
    ]).flat(),
  ];
  const failed = (await Promise.allSettled(removals))
    .filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed.length > 0) {
    throw new AggregateError(failed.map(({ reason }) => reason), "Failed to remove managed E2E run files");
  }

  await removeEmptyDirectory(resolve(STATE_DIR, "slots"));
  await removeEmptyDirectory(STATE_DIR);
  await removeEmptyDirectory(ARTIFACTS_DIR);
}

export default class CleanupReporter implements Reporter {
  private status: FullResult["status"] = "passed";

  onEnd(result: FullResult): void {
    this.status = result.status;
  }

  async onExit(): Promise<void> {
    try {
      await cleanupManagedRunFiles();
    } catch (error) {
      const message = `E2E managed-state cleanup failed: ${String(error)}`;
      if (this.status === "passed") throw new Error(message, { cause: error });
      console.error(message);
    }
  }
}

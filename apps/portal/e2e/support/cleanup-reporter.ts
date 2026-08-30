import { rm, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { FullResult, Reporter } from "@playwright/test/reporter";
import {
  ARTIFACTS_DIR,
  E2E_SLOTS,
  RUN_STATE_FILE,
  SERVER_LOG_DIR,
  slotStateDirFor,
  stateFileFor,
  STATE_DIR,
} from "./config";

const MANAGED_DIRECTORY_REMOVE_OPTIONS = {
  force: true,
  maxRetries: 10,
  recursive: true,
  retryDelay: 100,
} as const;

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
  }
}

async function cleanupManagedRunFiles(removeServerLogs: boolean): Promise<void> {
  const removals = [
    rm(RUN_STATE_FILE, { force: true }),
    rm(resolve(ARTIFACTS_DIR, ".last-run.json"), { force: true }),
    ...(removeServerLogs ? [rm(SERVER_LOG_DIR, MANAGED_DIRECTORY_REMOVE_OPTIONS)] : []),
    ...Array.from({ length: E2E_SLOTS }, (_, slot) => [
      rm(stateFileFor("admin", slot), { force: true }),
      rm(stateFileFor("member", slot), { force: true }),
      rm(slotStateDirFor(slot), MANAGED_DIRECTORY_REMOVE_OPTIONS),
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

export function shouldCleanupManagedRunFiles(argv: readonly string[] = process.argv): boolean {
  /* `playwright test --list` is an inspection command: it never owns the active run's
     sessions or slot directories, so removing them here can corrupt a concurrent E2E run. */
  return !argv.some((argument) => argument === "--list" || argument.startsWith("--list="));
}

export default class CleanupReporter implements Reporter {
  private status: FullResult["status"] = "passed";

  onEnd(result: FullResult): void {
    this.status = result.status;
  }

  async onExit(): Promise<void> {
    if (!shouldCleanupManagedRunFiles()) return;
    try {
      await cleanupManagedRunFiles(this.status === "passed");
    } catch (error) {
      const message = `E2E managed-state cleanup failed: ${String(error)}`;
      if (this.status === "passed") throw new Error(message, { cause: error });
      console.error(message);
    }
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("worker config preflight", () => {
  it("fails staging deploy preflight while staging D1 id is a placeholder", async () => {
    await expect(execFileAsync("node", ["scripts/check-worker-config.mjs", "--env=staging"]))
      .rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("STAGING_DB_ID_HERE"),
      });
  });
});

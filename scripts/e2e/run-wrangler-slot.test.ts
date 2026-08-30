import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLoggedCommand } from "./run-wrangler-slot.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("E2E Wrangler slot logging", () => {
  it("preserves output and an immediate non-zero child exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "infini-e2e-wrangler-log-"));
    temporaryDirectories.push(directory);
    const logPath = join(directory, "slot-0.log");

    const result = await runLoggedCommand({
      command: process.execPath,
      args: ["-e", "process.stderr.write('immediate nonzero\\n'); process.exit(17)"],
      cwd: process.cwd(),
      logPath,
      label: "probe",
    });

    expect(result).toMatchObject({ code: 17, signal: null, pid: expect.any(Number) });
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("[probe] pid=");
    expect(log).toContain("immediate nonzero");
    expect(log).toContain("[probe] exit code=17 signal=none");
  });
});

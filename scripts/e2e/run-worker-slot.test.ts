import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLoggedCommand, runWorkerSlot } from "./run-worker-slot.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("E2E Worker slot logging", () => {
  it("keeps preparation and serving debug output separate for concurrent slots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "infini-e2e-worker-debug-"));
    temporaryDirectories.push(directory);
    await Promise.all(["scripts/e2e", "apps/cloudflare/dist"].map(
      (path) => mkdir(join(directory, path), { recursive: true }),
    ));
    await Promise.all([
      writeFile(join(directory, "apps/cloudflare/dist/worker.mjs"), ""),
      writeFile(join(directory, "scripts/e2e/prepare-slot.mjs"),
        "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.WRANGLER_LOG_PATH, 'prepare\\n');"),
      writeFile(join(directory, "scripts/e2e/serve-worker-slot.mjs"),
        "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.WRANGLER_LOG_PATH, 'serve\\n');"),
    ]);

    const results = await Promise.all([0, 1].map((slot) => runWorkerSlot(slot, directory, {
      ...process.env,
      WRANGLER_LOG_PATH: join(directory, "shared.log"),
    })));

    expect(results).toEqual([0, 0]);
    for (const slot of [0, 1]) {
      expect(await readFile(join(directory, `apps/portal/e2e/.logs/slot-${slot}-config.debug.log`), "utf8"))
        .toBe("prepare\nserve\n");
    }
  });

  it("preserves output and an immediate non-zero child exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "infini-e2e-worker-log-"));
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

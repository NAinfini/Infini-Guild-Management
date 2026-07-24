import { describe, expect, it, vi } from "vitest";
import { runEventAutoArchiveCron } from "./event-auto-archive";

describe("event auto archive cron", () => {
  it("archives ended events only when auto archive is enabled and not already processed", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));

    await runEventAutoArchiveCron({ DB: { prepare } } as never);

    const sql = prepare.mock.calls.at(0)?.at(0);
    if (typeof sql !== "string") throw new Error("Expected SQL string");
    expect(sql).toContain("auto_archive = 1");
    expect(sql).toContain("auto_archived = 0");
    expect(bind).toHaveBeenCalledWith(expect.stringMatching(/^20\d\d-/));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

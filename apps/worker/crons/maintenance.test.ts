import { describe, expect, it } from "vitest";
import { DAILY_MAINTENANCE_JOBS, QUARTER_HOURLY_MAINTENANCE_JOBS } from "./maintenance";

describe("cron maintenance schedules", () => {
  it("runs daily maintenance at midnight UTC", () => {
    expect(DAILY_MAINTENANCE_JOBS.map((job) => job.name)).toEqual([
      "audit-archive",
      "media-orphan-cleanup",
      "error-log-cleanup",
    ]);
  });

  it("merges 15-minute maintenance into one dispatcher", () => {
    expect(QUARTER_HOURLY_MAINTENANCE_JOBS.map((job) => job.name)).toEqual([
      "event-instance-gen",
      "event-auto-archive",
      "session-cleanup",
      "announcement-publish",
    ]);
  });
});

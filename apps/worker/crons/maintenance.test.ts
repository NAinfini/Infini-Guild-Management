import { describe, expect, it } from "vitest";
import { DAILY_MAINTENANCE_JOBS, QUARTER_HOURLY_MAINTENANCE_JOBS } from "./maintenance";

describe("cron maintenance schedules", () => {
  it("runs daily maintenance at midnight UTC", () => {
    expect(DAILY_MAINTENANCE_JOBS.map((job) => job.name)).toEqual([
      "event-instance-gen",
      "session-cleanup",
      "audit-archive",
      "media-orphan-cleanup",
    ]);
  });

  it("merges 15-minute maintenance into one dispatcher", () => {
    expect(QUARTER_HOURLY_MAINTENANCE_JOBS.map((job) => job.name)).toEqual([
      "event-auto-archive",
      "announcement-publish",
      "announcement-expiry",
    ]);
  });
});

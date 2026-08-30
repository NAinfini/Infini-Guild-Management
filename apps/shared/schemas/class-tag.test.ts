import { describe, expect, it } from "vitest";
import {
  deleteClassTagSchema,
  reorderClassTagsSchema,
  updateClassTagSchema,
} from "./class-tag";

describe("class tag write contracts", () => {
  it("requires its record and usage baselines for mutations that can remove quota slots", () => {
    expect(updateClassTagSchema.safeParse({ label: "Frontline" }).success).toBe(false);
    expect(updateClassTagSchema.parse({
      label: "Frontline", expected_updated_at: "2026-08-09T12:00:00.000Z",
    })).toMatchObject({ expected_updated_at: "2026-08-09T12:00:00.000Z" });
    expect(deleteClassTagSchema.safeParse({ expected_updated_at: "2026-08-09T12:00:00.000Z" }).success).toBe(false);
    expect(deleteClassTagSchema.parse({
      expected_updated_at: "2026-08-09T12:00:00.000Z",
      expected_usage_count: 0,
    })).toMatchObject({ expected_usage_count: 0 });
    expect(reorderClassTagsSchema.safeParse({ order: ["frontline"] }).success).toBe(false);
  });
});

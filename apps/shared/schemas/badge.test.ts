import { describe, expect, it } from "vitest";
import { LIMITS } from "../config/limits";
import {
  badgeAssignmentsCursorResponseSchema,
  badgeAssignmentsListQuerySchema,
  createMemberBadgeSchema,
  updateMemberBadgeSchema,
} from "./badge";

const assignment = {
  badge_id: "badge-1",
  user_id: "user-1",
  display_name: "Member",
  assigned_by: "admin-1",
  assigned_by_display_name: "Admin",
  assigned_at: "2026-08-09T12:00:00.000Z",
};

describe("badge assignment pagination contract", () => {
  it("defaults to the bounded page maximum and rejects larger pages", () => {
    expect(badgeAssignmentsListQuerySchema.parse({})).toEqual({
      limit: LIMITS.pagination.badgeAssignments,
    });
    expect(badgeAssignmentsListQuerySchema.safeParse({
      limit: LIMITS.pagination.badgeAssignments + 1,
    }).success).toBe(false);
  });

  it("rejects response pages above the shared maximum", () => {
    expect(badgeAssignmentsCursorResponseSchema.safeParse({
      data: Array.from({ length: LIMITS.pagination.badgeAssignments }, () => assignment),
      next_cursor: "next",
    }).success).toBe(true);
    expect(badgeAssignmentsCursorResponseSchema.safeParse({
      data: Array.from({ length: LIMITS.pagination.badgeAssignments + 1 }, () => assignment),
      next_cursor: null,
    }).success).toBe(false);
  });
});

describe("badge write contracts", () => {
  it("allows PATCH to clear a description without widening create", () => {
    expect(updateMemberBadgeSchema.parse({ description: null })).toEqual({ description: null });
    expect(createMemberBadgeSchema.safeParse({
      name: "Veteran",
      label_html: "Veteran",
      description: null,
    }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveGuildWarAbsenceWindow } from "./GuildWarActiveTab";

describe("resolveGuildWarAbsenceWindow", () => {
  it("waits for the selected event date instead of falling back to today", () => {
    expect(resolveGuildWarAbsenceWindow(undefined)).toBeNull();
    expect(resolveGuildWarAbsenceWindow(null)).toBeNull();
  });

  it("queries absences for the selected event day", () => {
    expect(resolveGuildWarAbsenceWindow("2026-08-14T20:00:00.000Z")).toEqual({
      from: "2026-08-14",
      to: "2026-08-14",
    });
  });

  it("uses direct drag-and-drop at every breakpoint without duplicate save actions", () => {
    const board = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/guild-war/GuildWarDragBoard.tsx"),
      "utf8",
    );
    const activeTab = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/guild-war/GuildWarActiveTab.tsx"),
      "utf8",
    );

    expect(board).toContain("<GuildWarDragBoardLayout");
    expect(board).not.toContain("SegmentedControl");
    expect(board).not.toContain("selectedMovePanel");
    expect(board).not.toContain("onMoveSelected");
    expect(activeTab).not.toContain("onMoveSelected");
    expect(activeTab).not.toContain("onSaveTeams=");
  });
});

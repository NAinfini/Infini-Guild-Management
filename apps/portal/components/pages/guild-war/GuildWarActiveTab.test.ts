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

  it("keeps a complete non-drag mobile assignment flow", () => {
    const board = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/guild-war/GuildWarDragBoard.tsx"),
      "utf8",
    );
    const activeTab = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/guild-war/GuildWarActiveTab.tsx"),
      "utf8",
    );

    expect(board).toContain('value: "pool"');
    expect(board).toContain('value: "teams"');
    expect(board).toContain('value: "status"');
    expect(board).toContain("onMoveSelected(mobileTarget)");
    expect(board).toContain("onRemoveSelected");
    expect(activeTab).toContain('handleMoveSelectedTo("remove")');
  });
});

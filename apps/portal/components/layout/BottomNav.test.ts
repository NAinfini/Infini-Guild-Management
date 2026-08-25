import { describe, expect, it } from "vitest";
import { groupBottomNavItems, type BottomNavItem } from "./BottomNav";

const Icon = () => null;

function item(label: string, groupLabel?: string): BottomNavItem {
  return { to: `/${label}`, label, icon: Icon, groupLabel };
}

describe("BottomNav", () => {
  it("groups More destinations by their shared navigation metadata without reordering them", () => {
    const groups = groupBottomNavItems([
      item("Announcements", "Community"),
      item("Gallery", "Community"),
      item("Storage", "Operations"),
      item("Settings", "Personal"),
      item("Tools", "Operations"),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Community", "Operations", "Personal"]);
    expect(groups.map((group) => group.items.map((entry) => entry.label))).toEqual([
      ["Announcements", "Gallery"],
      ["Storage", "Tools"],
      ["Settings"],
    ]);
  });
});

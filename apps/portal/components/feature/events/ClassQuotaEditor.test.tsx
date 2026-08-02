// @vitest-environment jsdom
import type { ClassCatalogItem, ClassTag, EventClassQuotaInput } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { useClassCatalogStore } from "@portal/stores/class-catalog";
import { useClassTagStore } from "@portal/stores/class-tag";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassQuotaEditor } from "./ClassQuotaEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

function catalogItem(id: string, label: string, sortOrder: number): ClassCatalogItem {
  return {
    id,
    label,
    color: "#888888",
    icon_type: "vector",
    vector_icon: "sword",
    icon_key: null,
    sort_order: sortOrder,
    created_at: "",
    updated_at: "",
  };
}

const CATALOG = [
  catalogItem("healer-a", "Healer A", 1),
  catalogItem("healer-b", "Healer B", 2),
  catalogItem("dps-a", "DPS A", 3),
  catalogItem("dps-b", "DPS B", 4),
  catalogItem("dps-c", "DPS C", 5),
  catalogItem("dps-d", "DPS D", 6),
  catalogItem("dps-e", "DPS E", 7),
  catalogItem("loner", "Loner", 8),
];

const TAGS: ClassTag[] = [
  {
    id: "tag-heal",
    label: "Healers",
    class_ids: ["healer-a", "healer-b"],
    sort_order: 1,
    created_at: "",
    updated_at: "",
  },
  {
    id: "tag-dps",
    label: "Damage",
    class_ids: ["dps-a", "dps-b", "dps-c", "dps-d", "dps-e", "healer-b", "loner"],
    sort_order: 2,
    created_at: "",
    updated_at: "",
  },
];

function renderEditor(value: EventClassQuotaInput[], onChange = vi.fn()) {
  render(
    <MantineProvider>
      <ClassQuotaEditor value={value} onChange={onChange} />
    </MantineProvider>,
  );
  return onChange;
}

describe("ClassQuotaEditor", () => {
  beforeEach(() => {
    useClassCatalogStore.setState({ items: CATALOG });
    useClassTagStore.setState({ tags: TAGS });
  });

  it("shows a catalog tag's classes as a read-only strip that keeps every name in reach", () => {
    renderEditor([{ tag_id: "tag-dps", required: 2 }]);

    const cell = screen.getByRole("group", { name: "quota.editor.classes" });
    const strip = cell.querySelector(".quota-editor__strip");
    /* 图标只画 6 个，第 7 个收进 +1；名字一个不少地留在 title 上。 */
    expect(strip?.querySelectorAll(".class-icon")).toHaveLength(6);
    expect(strip?.querySelector(".quota-editor__strip-more")?.textContent).toBe("+1");
    expect(strip).toHaveAttribute(
      "title",
      "DPS A, DPS B, DPS C, DPS D, DPS E, Healer B, Loner",
    );
    /* 只读那一格不该有可点的东西。 */
    expect(cell.querySelector("button")).toBeNull();
  });

  it("ticks one class from the picker without disturbing the rest of the quota", async () => {
    const user = userEvent.setup();
    const onChange = renderEditor([
      { tag: { label: "Off-tanks", class_ids: ["dps-a"] }, required: 3 },
    ]);

    await user.click(screen.getByRole("button", { name: "quota.editor.pickClasses" }));
    // 下拉在 Mantine 的过渡里，jsdom 下过渡停在 display: none，按角色取必须放开 hidden。
    await user.click(await screen.findByRole("checkbox", { name: /Loner/, hidden: true }));

    expect(onChange).toHaveBeenCalledWith([
      { tag: { label: "Off-tanks", class_ids: ["dps-a", "loner"] }, required: 3 },
    ]);
  });

  it("brings in a whole saved group at once, skipping what is already picked", async () => {
    const user = userEvent.setup();
    const onChange = renderEditor([
      { tag: { label: "Off-tanks", class_ids: ["healer-b"] }, required: 3 },
    ]);

    await user.click(screen.getByRole("button", { name: "quota.editor.pickClasses" }));
    const [bringHealers] = await screen.findAllByRole("button", {
      name: "quota.editor.bringGroup",
      hidden: true,
    });
    await user.click(bringHealers!);

    expect(onChange).toHaveBeenCalledWith([
      { tag: { label: "Off-tanks", class_ids: ["healer-b", "healer-a"] }, required: 3 },
    ]);
  });

  it("narrows the checklist by search and says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderEditor([{ tag: { label: "Off-tanks", class_ids: [] }, required: 1 }]);

    await user.click(screen.getByRole("button", { name: "quota.editor.pickClasses" }));
    const search = await screen.findByPlaceholderText("quota.editor.searchClasses");

    await user.type(search, "healer");
    expect(screen.getByRole("checkbox", { name: /Healer A/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Loner/, hidden: true })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "nobody");
    expect(screen.getByText("quota.editor.noClassMatch")).toBeInTheDocument();
  });
});

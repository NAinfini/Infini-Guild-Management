// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAdminClassTagsController } from "@portal/hooks/useAdminClassTagsController";
import { useClassCatalogStore } from "@portal/stores/class-catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminClassTagsSection } from "./AdminClassTagsSection";

vi.mock("@portal/hooks/useAdminClassTagsController", () => ({
  useAdminClassTagsController: vi.fn(),
}));

const confirm = vi.fn();
vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirm,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    /* 插值真的填进去：删除确认里那个「有几格配额在用」正是这条用例要看的东西。 */
    t: (key: string, vars?: Record<string, unknown>) => (
      vars ? `${key}:${Object.values(vars).join(",")}` : key
    ),
  }),
}));

const STAMPS = { sort_order: 0, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" };
const CATALOG = [
  { id: "white-mage", label: "White Mage", icon_type: "vector" as const, vector_icon: "heart" as const, icon_key: null, color: "#61B8AA", ...STAMPS },
  { id: "droid", label: "Droid", icon_type: "vector" as const, vector_icon: "sword" as const, icon_key: null, color: "#6EA8FE", ...STAMPS, sort_order: 10 },
];

const HEALER_TAG = {
  id: "healer",
  label: "Healer",
  class_ids: ["white-mage"],
  sort_order: 0,
  usage_count: 3,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

function renderSection(overrides: Record<string, unknown> = {}) {
  const toggleClass = vi.fn();
  const remove = vi.fn().mockResolvedValue({ deleted: true });
  vi.mocked(useAdminClassTagsController).mockReturnValue({
    query: { data: [HEALER_TAG], isLoading: false, isError: false, refetch: vi.fn() },
    opened: true,
    draft: { id: "healer", label: "Healer", classIds: ["white-mage"], sortOrder: 0 },
    setDraft: vi.fn(),
    toggleClass,
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    close: vi.fn(),
    save: vi.fn(),
    remove,
    savePending: false,
    deletePending: false,
    ...overrides,
  } as unknown as ReturnType<typeof useAdminClassTagsController>);

  return {
    toggleClass,
    remove,
    ...render(
      <MantineProvider>
        <AdminClassTagsSection />
      </MantineProvider>,
    ),
  };
}

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true);
  useClassCatalogStore.getState().setItems(CATALOG);
});

describe("AdminClassTagsSection", () => {
  it("offers every class in the catalog and marks the ones already in the tag", () => {
    renderSection();

    const inTag = screen.getByRole("button", { pressed: true, name: /White Mage/ });
    const outOfTag = screen.getByRole("button", { pressed: false, name: /Droid/ });

    expect(inTag).toBeEnabled();
    /* 没被选中的职业照样可点：一个职业进几个标签、标签之间怎么重叠都不设限，
       界面上不该出现任何「这样组不合理」的拦截。 */
    expect(outOfTag).toBeEnabled();
  });

  it("toggles a class in and out without any other confirmation", async () => {
    const { toggleClass } = renderSection();

    await userEvent.click(screen.getByRole("button", { pressed: false, name: /Droid/ }));

    expect(toggleClass).toHaveBeenCalledWith("droid");
  });

  it("tells the admin how many quota slots a delete will take with it", async () => {
    const { remove } = renderSection();

    await userEvent.click(screen.getByRole("button", { name: "classTags.action.delete" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]?.description).toContain("3");
    expect(remove).toHaveBeenCalledWith("healer");
  });
});

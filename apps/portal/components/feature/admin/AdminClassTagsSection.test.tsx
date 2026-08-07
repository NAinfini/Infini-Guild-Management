// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
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

// Tag membership is many-to-many, so overlapping classes are valid fixtures.
const RAID_TAG = { ...HEALER_TAG, id: "raid", label: "Raid", sort_order: 10, usage_count: 0 };

function renderSection(overrides: Record<string, unknown> = {}) {
  const toggleClass = vi.fn();
  const remove = vi.fn().mockResolvedValue({ deleted: true });
  vi.mocked(useAdminClassTagsController).mockReturnValue({
    query: { data: [HEALER_TAG, RAID_TAG], isLoading: false, isError: false, refetch: vi.fn() },
    opened: true,
    editing: true,
    draft: { id: "healer", label: "Healer", classIds: ["white-mage"] },
    setDraft: vi.fn(),
    toggleClass,
    openCreate: vi.fn(),
    selectTag: vi.fn(),
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    reorder: vi.fn(),
    save: vi.fn(),
    remove,
    savePending: false,
    deletePending: false,
    reorderPending: false,
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
  it("keeps every class on one list and marks which ones are in the tag", () => {
    renderSection();

    expect(screen.getByRole("checkbox", { name: "White Mage" })).toBeChecked();
    const outOfTag = screen.getByRole("checkbox", { name: "Droid" });
    expect(outOfTag).toBeEnabled();
    expect(outOfTag).not.toBeChecked();
  });

  it("shows which other tags a class already belongs to", () => {
    renderSection();

    const inTag = screen.getByRole("checkbox", { name: "White Mage" }).closest(".pick-list__row") as HTMLElement;
    expect(inTag).toHaveTextContent("Raid");
    expect(inTag.querySelector(".pick-list__row-meta")?.textContent).not.toContain("Healer");
    const outOfTag = screen.getByRole("checkbox", { name: "Droid" }).closest(".pick-list__row") as HTMLElement;
    expect(outOfTag.querySelector(".pick-list__row-meta")).toBeNull();
  });

  it("toggles a class straight from the list without any other confirmation", async () => {
    const user = userEvent.setup();
    const { toggleClass } = renderSection();

    await user.click(screen.getByRole("checkbox", { name: "Droid" }));
    expect(toggleClass).toHaveBeenCalledWith("droid");

    await user.click(screen.getByRole("checkbox", { name: "White Mage" }));
    expect(toggleClass).toHaveBeenCalledWith("white-mage");
  });

  it("keeps search and the limit guidance without bulk controls or a selected count", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.type(screen.getByLabelText("classTags.members.searchPlaceholder"), "Dro");
    expect(screen.queryByRole("checkbox", { name: "White Mage" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Droid" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "classTags.members.selectAll" })).toBeNull();
    expect(screen.queryByRole("button", { name: "classTags.members.clear" })).toBeNull();
    expect(screen.queryByText(/^classTags\.members\.counter:/)).toBeNull();
    expect(screen.getByText(/^classTags\.field\.membersDescription:/)).toBeInTheDocument();
  });

  it("refuses to save a tag nobody touched", () => {
    renderSection();

    expect(screen.queryByText("classTags.dirty")).toBeNull();
    expect(screen.getByRole("button", { name: "classTags.action.save" })).toBeDisabled();
  });

  it("flags edits that are still only in the draft", () => {
    renderSection({ draft: { id: "healer", label: "Healer", classIds: ["white-mage", "droid"] } });

    expect(screen.getByText("classTags.dirty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "classTags.action.save" })).toBeEnabled();
  });

  it("renders the drag handle outside the row's open button", () => {
    renderSection();

    const handle = screen.getByRole("button", { name: "classTags.aria.dragHandle:Healer" });
    expect(handle.closest(".admin-md__item")).toBeNull();
  });

  it("opens a tag read-only and only edits after the edit button", async () => {
    const user = userEvent.setup();
    const startEdit = vi.fn();
    renderSection({ editing: false, startEdit });

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("classTags.members.searchPlaceholder")).toBeNull();
    expect(screen.queryByRole("button", { name: "classTags.action.save" })).toBeNull();
    const list = document.querySelector(".pick-list__body") as HTMLElement;
    expect(within(list).getByText("White Mage")).toBeInTheDocument();
    expect(within(list).queryByText("Droid")).toBeNull();

    await user.click(screen.getByRole("button", { name: "classTags.editTitle" }));
    expect(startEdit).toHaveBeenCalledTimes(1);
  });

  it("hides the edit button once the editor is already open", () => {
    renderSection();

    expect(screen.queryByRole("button", { name: "classTags.editTitle" })).toBeNull();
    expect(screen.getByRole("button", { name: "classTags.action.save" })).toBeInTheDocument();
  });

  it("locks the drag handle while a reorder is still in flight", () => {
    renderSection({ reorderPending: true });

    expect(screen.getByRole("button", { name: "classTags.aria.dragHandle:Healer" })).toBeDisabled();
  });

  it("tells the admin how many quota slots a delete will take with it", async () => {
    const user = userEvent.setup();
    const { remove } = renderSection();

    await user.click(screen.getByRole("button", { name: "classTags.action.delete" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]?.description).toContain("3");
    expect(remove).toHaveBeenCalledWith("healer");
  });
});

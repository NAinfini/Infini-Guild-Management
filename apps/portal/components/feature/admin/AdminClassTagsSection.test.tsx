import { createSeededQueryClient } from "@portal/tests/query-harness";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAdminClassTagsController } from "@portal/hooks/useAdminClassTagsController";
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
  { id: "white-mage", label: "White Mage", icon_type: "vector" as const, vector_icon: "heart" as const, icon_media_id: null, color: "#61B8AA", ...STAMPS },
  { id: "droid", label: "Droid", icon_type: "vector" as const, vector_icon: "sword" as const, icon_media_id: null, color: "#6EA8FE", ...STAMPS, sort_order: 10 },
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
    draft: { id: "healer", label: "Healer", classIds: ["white-mage"] },
    setDraft: vi.fn(),
    isDirty: false,
    toggleClass,
    openCreate: vi.fn(),
    selectTag: vi.fn(),
    discardChanges: vi.fn(),
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
      <QueryClientProvider client={queryClient}>
        <AdminClassTagsSection />
      </QueryClientProvider>,
    ),
  };
}

let queryClient: QueryClient;

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true);
  queryClient = createSeededQueryClient({ classes: CATALOG });
});

describe("AdminClassTagsSection", () => {
  it("keeps cached tags visible after a failed refresh", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    renderSection({
      query: {
        data: [HEALER_TAG, RAID_TAG],
        isLoading: false,
        isError: true,
        isFetching: false,
        refetch,
      },
    });

    expect(screen.getByText("Healer")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("loadError");
    await user.click(screen.getByRole("button", { name: "action.retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

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
    renderSection({
      draft: { id: "healer", label: "Healer", classIds: ["white-mage", "droid"] },
      isDirty: true,
    });

    expect(screen.getByText("classTags.dirty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "classTags.action.save" })).toBeEnabled();
  });

  it("renders the drag handle in the row surface but outside the open button", () => {
    renderSection();

    const handle = screen.getByRole("button", { name: "classTags.aria.dragHandle:Healer" });
    expect(handle.closest(".admin-md__row")).not.toBeNull();
    expect(handle.closest(".admin-md__item")).toBeNull();
  });

  it("shows the fields and class picker immediately without an edit gate", () => {
    renderSection();

    expect(screen.queryByRole("button", { name: "classTags.editTitle" })).toBeNull();
    expect(screen.getByDisplayValue("Healer")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "White Mage" })).toBeChecked();
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
    expect(remove).toHaveBeenCalledWith("healer", HEALER_TAG.updated_at, HEALER_TAG.usage_count);
  });
});

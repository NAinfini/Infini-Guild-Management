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

/* 第二个标签跟 Healer 重叠（都装了 White Mage）：多对多下最容易算错的就是这种重叠，
   成员清单必须把它标出来。 */
const RAID_TAG = { ...HEALER_TAG, id: "raid", label: "Raid", sort_order: 10, usage_count: 0 };

function renderSection(overrides: Record<string, unknown> = {}) {
  const toggleClass = vi.fn();
  const remove = vi.fn().mockResolvedValue({ deleted: true });
  vi.mocked(useAdminClassTagsController).mockReturnValue({
    query: { data: [HEALER_TAG, RAID_TAG], isLoading: false, isError: false, refetch: vi.fn() },
    opened: true,
    /* 多数用例看的是编辑态里的清单，所以默认直接给编辑态；查看态由它自己那条用例覆盖。 */
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

    /* 一栏勾选清单，不再是可选／已选两栏：整份目录始终在场，勾选框就是答案。
       行的语义统一到 checkbox（shared/PickList），读屏器报的是勾没勾，不是按没按。 */
    expect(screen.getByRole("checkbox", { name: "White Mage" })).toBeChecked();
    /* 没被选中的职业照样可加：一个职业进几个标签、标签之间怎么重叠都不设限，
       界面上不该出现任何「这样组不合理」的拦截。 */
    const outOfTag = screen.getByRole("checkbox", { name: "Droid" });
    expect(outOfTag).toBeEnabled();
    expect(outOfTag).not.toBeChecked();
  });

  it("shows which other tags a class already belongs to", () => {
    renderSection();

    /* White Mage 同时在 Raid 里，这条重叠只有在成员行上标出来才看得见；
       正在编辑的 Healer 自己不算——那是行首勾选框的事。 */
    const inTag = screen.getByRole("checkbox", { name: "White Mage" }).closest(".pick-list__row") as HTMLElement;
    expect(inTag).toHaveTextContent("Raid");
    expect(inTag.querySelector(".pick-list__row-meta")?.textContent).not.toContain("Healer");
    const outOfTag = screen.getByRole("checkbox", { name: "Droid" }).closest(".pick-list__row") as HTMLElement;
    expect(outOfTag.querySelector(".pick-list__row-meta")).toBeNull();
  });

  it("toggles a class straight from the list without any other confirmation", async () => {
    const { toggleClass } = renderSection();

    await userEvent.click(screen.getByRole("checkbox", { name: "Droid" }));
    expect(toggleClass).toHaveBeenCalledWith("droid");

    await userEvent.click(screen.getByRole("checkbox", { name: "White Mage" }));
    expect(toggleClass).toHaveBeenCalledWith("white-mage");
  });

  it("adds every class the search left visible in one click", async () => {
    const setDraft = vi.fn();
    renderSection({ setDraft });

    await userEvent.type(screen.getByLabelText("classTags.members.searchPlaceholder"), "Dro");
    /* 搜索之后清单只剩 Droid，全选就该只加它——批量按钮作用于可见的那些行。 */
    expect(screen.queryByRole("checkbox", { name: "White Mage" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "classTags.members.selectAll" }));
    const updater = setDraft.mock.calls.at(-1)?.[0] as (d: unknown) => { classIds: string[] };
    expect(updater({ id: "healer", label: "Healer", classIds: ["white-mage"] }).classIds)
      .toEqual(["white-mage", "droid"]);
  });

  it("refuses to save a tag nobody touched", () => {
    renderSection();

    expect(screen.queryByText("classTags.dirty")).toBeNull();
    expect(screen.getByRole("button", { name: "classTags.action.save" })).toBeDisabled();
  });

  it("flags edits that are still only in the draft", () => {
    /* 勾选只改本地草稿，落库要点保存；而左栏拖拽是即时的。同一页两种提交语义，
       不标出来的话，改完几个勾直接切到下一个标签就白改了。 */
    renderSection({ draft: { id: "healer", label: "Healer", classIds: ["white-mage", "droid"] } });

    expect(screen.getByText("classTags.dirty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "classTags.action.save" })).toBeEnabled();
  });

  it("keeps the drag handle outside the row's open button", async () => {
    const selectTag = vi.fn();
    renderSection({ selectTag });

    const handle = screen.getByRole("button", { name: "classTags.aria.dragHandle:Healer" });
    /* 手柄嵌进那颗按钮里的话，HTML 非法且点手柄会顺带把标签打开。 */
    expect(handle.closest(".admin-md__item")).toBeNull();

    await userEvent.click(screen.getAllByText("Healer")[0]!);
    expect(selectTag).toHaveBeenCalledTimes(1);

    /* 手柄放在最后点：dnd-kit 的指针监听会在 pointerdown 后接管文档级事件。 */
    await userEvent.click(handle);
    expect(selectTag).toHaveBeenCalledTimes(1);
  });

  /*
   * 选中一个标签先只是「看」。原先点一下左栏就直接落进表单，于是想确认「坦克里都有谁」
   * 也得先进一个可写的界面，手一滑就改了——而勾选是不弹确认的。
   */
  it("opens a tag read-only and only edits after the edit button", async () => {
    const startEdit = vi.fn();
    renderSection({ editing: false, startEdit });

    /* 查看态没有勾选框、没有搜索、没有保存，只列装进来的那几个职业。 */
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("classTags.members.searchPlaceholder")).toBeNull();
    expect(screen.queryByRole("button", { name: "classTags.action.save" })).toBeNull();
    const list = document.querySelector(".pick-list__body") as HTMLElement;
    expect(within(list).getByText("White Mage")).toBeInTheDocument();
    expect(within(list).queryByText("Droid")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "classTags.editTitle" }));
    expect(startEdit).toHaveBeenCalledTimes(1);
  });

  it("hides the edit button once the editor is already open", () => {
    renderSection();

    expect(screen.queryByRole("button", { name: "classTags.editTitle" })).toBeNull();
    expect(screen.getByRole("button", { name: "classTags.action.save" })).toBeInTheDocument();
  });

  it("locks the drag handle while a reorder is still in flight", () => {
    /* 上一次重排还在飞时不允许再拖：两个 PATCH 并发，先发的可能后到，
       onSuccess 会把旧顺序写回缓存。 */
    renderSection({ reorderPending: true });

    expect(screen.getByRole("button", { name: "classTags.aria.dragHandle:Healer" })).toBeDisabled();
  });

  it("tells the admin how many quota slots a delete will take with it", async () => {
    const { remove } = renderSection();

    await userEvent.click(screen.getByRole("button", { name: "classTags.action.delete" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]?.description).toContain("3");
    expect(remove).toHaveBeenCalledWith("healer");
  });
});

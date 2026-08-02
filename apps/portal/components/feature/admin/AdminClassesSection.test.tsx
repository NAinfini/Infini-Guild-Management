// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAdminClassesController } from "@portal/hooks/useAdminClassesController";
import { describe, expect, it, vi } from "vitest";
import { AdminClassesSection } from "./AdminClassesSection";

vi.mock("@portal/hooks/useAdminClassesController", () => ({
  useAdminClassesController: vi.fn(),
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    /* 把 {{name}} 真的填进去：拖拽手柄靠它区分是哪一行，不插值就三个手柄同名。 */
    t: (key: string, vars?: Record<string, unknown>) => (
      vars ? `${key}:${Object.values(vars).join(",")}` : key
    ),
  }),
}));

/* 特意用 shield：ShieldIcon 曾经用 spring 动 3 个关键帧，一 hover 就抛未捕获错误，
   就是在这条用例里炸出来的。留着它当哨兵，回归了这里会立刻响。 */
const CLASS_ROWS = [
  { id: "warden", label: "Warden", icon_type: "vector" as const, vector_icon: "shield" as const, icon_key: null, color: "#61B8AA" },
  { id: "seer", label: "Seer", icon_type: "vector" as const, vector_icon: "swords" as const, icon_key: null, color: "#6EA8FE" },
];

function renderSection(
  iconMode: "vector" | "image",
  colorScheme: "light" | "dark" = "light",
  overrides: Partial<ReturnType<typeof useAdminClassesController>> = {},
) {
  const openEdit = vi.fn();
  vi.mocked(useAdminClassesController).mockReturnValue({
    query: {
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
    opened: true,
    close: vi.fn(),
    draft: {
      id: null,
      label: "",
      color: "#61B8AA",
      vectorIcon: "sword",
      iconMode,
      sortOrder: 0,
      imageFile: null,
    },
    setDraft: vi.fn(),
    openCreate: vi.fn(),
    openEdit,
    save: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    savePending: false,
    deletePending: false,
    reorderPending: false,
    uploadProgress: 0,
    ...overrides,
  } as unknown as ReturnType<typeof useAdminClassesController>);

  return {
    openEdit,
    ...render(
      <MantineProvider forceColorScheme={colorScheme}>
        <AdminClassesSection />
      </MantineProvider>,
    ),
  };
}

describe("AdminClassesSection icon source", () => {
  it.each(["light", "dark"] as const)(
    "hides vector icon choices while using a custom image in the %s theme",
    (colorScheme) => {
      renderSection("image", colorScheme);

      expect(screen.getByText("classes.upload.title")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "classes.upload.choose" })).toBeInTheDocument();
      expect(screen.queryByText("classes.field.fallbackIcon")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "classes.iconLibrary" })).not.toBeInTheDocument();
    },
  );

  it("keeps the icon library visible for the vector source", () => {
    renderSection("vector");

    expect(screen.getByText("classes.field.fallbackIcon")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "classes.iconLibrary" })).toBeInTheDocument();
    expect(screen.queryByText("classes.upload.title")).not.toBeInTheDocument();
  });
});

describe("AdminClassesSection drag-to-sort", () => {
  const withRows = {
    query: { data: CLASS_ROWS, isLoading: false, isError: false, refetch: vi.fn() },
  } as unknown as Partial<ReturnType<typeof useAdminClassesController>>;

  it("keeps the drag handle outside the row's edit button", async () => {
    const { openEdit } = renderSection("vector", "light", withRows);

    const handle = screen.getByRole("button", { name: "classes.aria.dragHandle:Warden" });
    /* 手柄嵌进编辑按钮里的话，HTML 非法且点手柄会顺带打开编辑器。 */
    expect(handle.closest(".admin-md__item")).toBeNull();

    await userEvent.click(screen.getByText("Warden"));
    expect(openEdit).toHaveBeenCalledTimes(1);

    /* 手柄放在最后点：dnd-kit 的指针监听会在 pointerdown 后接管文档级事件，
       先点手柄的话后面那次点击会被它吃掉，测出来的就不是组件的行为了。 */
    await userEvent.click(handle);
    expect(openEdit).toHaveBeenCalledTimes(1);
  });

  it("locks every handle while a reorder is still in flight", () => {
    renderSection("vector", "light", { ...withRows, reorderPending: true });

    for (const name of ["Warden", "Seer"]) {
      expect(screen.getByRole("button", { name: `classes.aria.dragHandle:${name}` })).toBeDisabled();
    }
  });
});

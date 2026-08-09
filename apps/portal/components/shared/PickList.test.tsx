// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PickList } from "./PickList";

const OPTIONS = [
  { id: "a", label: "Alice" },
  { id: "b", label: "Bob" },
  { id: "c", label: "Carol" },
];

function renderList(props: Partial<Parameters<typeof PickList>[0]> = {}) {
  const onToggle = vi.fn();
  render(
    <MantineProvider>
      <PickList
        options={OPTIONS}
        selected={new Set<string>()}
        onToggle={onToggle}
        emptyLabel="nothing here"
        {...props}
      />
    </MantineProvider>,
  );
  return { onToggle };
}

describe("PickList", () => {
  it("gives every row a checkbox named after its label", async () => {
    const { onToggle } = renderList({ selected: new Set(["b"]) });

    expect(screen.getByRole("checkbox", { name: "Alice" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bob" })).toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: "Carol" }));
    expect(onToggle).toHaveBeenCalledWith("c");
  });

  /* 上限只锁没勾上的：已经在里面的那些还得能取消，否则一到上限就再也改不动了。 */
  it("locks the unpicked rows once the cap is reached and leaves the picked ones toggleable", () => {
    renderList({ selected: new Set(["a", "b"]), max: 2 });

    expect(screen.getByRole("checkbox", { name: "Carol" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Alice" })).toBeEnabled();
  });

  it("keeps a caller-disabled row disabled even below the cap", () => {
    renderList({
      options: [{ id: "a", label: "Alice", disabled: true }],
      max: 5,
    });

    expect(screen.getByRole("checkbox", { name: "Alice" })).toBeDisabled();
  });

  it("shows the empty line instead of an empty box", () => {
    renderList({ options: [] });

    expect(screen.getByText("nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  /* 过滤在调用方那边做，组件只把搜索框的输入交回去。 */
  it("hands typing back to the caller instead of filtering on its own", async () => {
    const onChange = vi.fn();
    renderList({ search: { value: "", onChange, placeholder: "search" } });

    await userEvent.type(screen.getByLabelText("search"), "A");
    expect(onChange).toHaveBeenCalledWith("A");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("keeps grouped options individually selectable", () => {
    render(
      <MantineProvider>
        <PickList
          sections={[
            {
              key: "healer",
              label: "Healer",
              options: [{ id: "a", label: "Alice" }],
            },
            { key: "rest", label: "Ungrouped", options: [{ id: "b", label: "Bob" }] },
          ]}
          selected={new Set<string>()}
          onToggle={vi.fn()}
          emptyLabel="nothing here"
        />
      </MantineProvider>,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("keeps caller save and cancel actions without exposing bulk or status APIs", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/PickList.tsx"), "utf8");

    expect(source).not.toMatch(/\bbulk\?:/);
    expect(source).not.toMatch(/\bstatus\?:/);
    expect(source).not.toMatch(/\baction\?: ReactNode/);

    renderList({
      actions: (
        <>
          <button type="button">Cancel</button>
          <button type="button">Save</button>
        </>
      ),
    });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("lets a finished list hand wheel scrolling back to its native parent", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/PickList.css"), "utf8");
    const bodyRule = css.match(/\.pick-list__body\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(bodyRule).toContain("overflow: hidden auto");
    expect(bodyRule).not.toContain("overscroll-behavior");
  });
});

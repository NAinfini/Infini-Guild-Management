// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AvailabilityEditor } from "./AvailabilityEditor";

/* 断言里直接用 key。翻译文案本身由 i18n 的中英对照测试守着，这里守的是行为。 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
  }),
}));

function renderEditor(props: Parameters<typeof AvailabilityEditor>[0]) {
  return render(
    <MantineProvider>
      <AvailabilityEditor {...props} />
    </MantineProvider>,
  );
}

function blockTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".availability-block")).map(
    (node) => node.textContent ?? "",
  );
}

describe("AvailabilityEditor", () => {
  it("renders one row per weekday and marks empty days as empty", () => {
    const { container } = renderEditor({ value: null, onChange: vi.fn() });

    expect(container.querySelectorAll(".availability-day")).toHaveLength(7);
    expect(container.querySelectorAll(".availability-day__empty")).toHaveLength(7);
    expect(blockTexts(container)).toHaveLength(0);
  });

  it("merges a preset into the days it covers instead of replacing them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.weeknights"));
    await user.click(screen.getByText("availability.editor.preset.lateNight"));

    const payload = onChange.mock.calls.at(-1)?.[0].availability;
    /* 工作日晚上铺周一到周五，深夜档铺全周：周一该有两条，周六只有一条。 */
    expect(payload.days.monday).toHaveLength(2);
    expect(payload.days.saturday).toHaveLength(1);
    expect(blockTexts(container)).toContain("00:00–03:00");
    expect(blockTexts(container)).toContain("20:00–24:00");
  });

  it("adds a block from the day picker with the default range", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderEditor({ value: null, onChange });

    await user.click(
      screen.getByRole("button", {
        name: "availability.editor.addBlock:availability.editor.dayMon",
      }),
    );
    /* 弹层带过渡动画，机器忙的时候挂载会晚一拍——用 find 而不是 get。 */
    await user.click(await screen.findByText("availability.editor.confirmAdd"));

    expect(blockTexts(container)).toEqual(["20:00–24:00"]);
    expect(onChange.mock.calls.at(-1)?.[0].availability.days.monday).toHaveLength(1);
  });

  it("survives a save/reload round trip for a block that ends at midnight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container, rerender } = renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.weeknights"));
    const payload = onChange.mock.calls.at(-1)?.[0].availability;

    /* 读回落库的 UTC 值：结束时间跨过午夜会回到 00:00，不还原成 24:00 就会被当成
       空区间丢掉——旧的网格编辑器正是这样吃掉每段到午夜为止的时间。 */
    rerender(
      <MantineProvider>
        <AvailabilityEditor value={payload as unknown as Record<string, unknown>} onChange={onChange} />
      </MantineProvider>,
    );

    expect(blockTexts(container).filter((text) => text === "20:00–24:00")).toHaveLength(5);
  });

  it("removes a single block without touching the rest of the day", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.lateNight"));
    await user.click(screen.getByText("availability.editor.preset.everyEvening"));
    expect(blockTexts(container)).toHaveLength(14);

    await user.click(
      screen.getByRole("button", {
        name: "availability.editor.removeBlock:availability.editor.dayMon,00:00,03:00",
      }),
    );

    const payload = onChange.mock.calls.at(-1)?.[0].availability;
    expect(payload.days.monday).toHaveLength(1);
    expect(payload.days.tuesday).toHaveLength(2);
  });

  it("copies a day onto another day, merging with what is already there", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.weekends"));
    /* 周六是第六行；周末预设之后只有周六周日的「复制到…」是可点的。 */
    const saturdayRow = container.querySelectorAll(".availability-day")[5] as HTMLElement;
    await user.click(saturdayRow.querySelector(".availability-day__copy") as HTMLElement);
    /* jsdom 没有布局，floating-ui 会隐藏 portal 菜单；这里只验证菜单内容和复制行为。 */
    const target = await screen.findByRole("menuitem", { name: "availability.editor.dayMon", hidden: true });
    await user.click(target);

    const payload = onChange.mock.calls.at(-1)?.[0].availability;
    expect(payload.days.monday).toHaveLength(1);
    expect(payload.days.saturday).toHaveLength(1);
  });
});

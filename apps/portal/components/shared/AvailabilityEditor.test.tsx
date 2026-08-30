import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  convertAvailabilityToLocalDays,
  convertLocalDaysToAvailability,
  type DayBlocks,
} from "../../utils/availability";
import { viewerUtcOffsetMinutes } from "../../utils/datetime";
import { AvailabilityEditor } from "./AvailabilityEditor";

/* 断言里直接用 key。翻译文案本身由 i18n 的中英对照测试守着，这里守的是行为。 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
  }),
}));

function renderEditor(props: Parameters<typeof AvailabilityEditor>[0]) {
  return render(<AvailabilityEditor {...props} />);
}

function emptyDays(): DayBlocks {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

function lastLocalDays(onChange: ReturnType<typeof vi.fn>): DayBlocks {
  const availability = onChange.mock.calls.at(-1)?.[0].availability ?? null;
  return convertAvailabilityToLocalDays(availability, viewerUtcOffsetMinutes());
}

describe("AvailabilityEditor", () => {
  it("merges a preset into the days it covers instead of replacing them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.weeknights"));
    await user.click(screen.getByText("availability.editor.preset.lateNight"));

    const localDays = lastLocalDays(onChange);
    /* 工作日晚上铺周一到周五，深夜档铺全周：周一该有两条，周六只有一条。 */
    expect(localDays.monday).toEqual([
      { start: "00:00", end: "03:00" },
      { start: "20:00", end: "24:00" },
    ]);
    expect(localDays.saturday).toEqual([{ start: "00:00", end: "03:00" }]);
  });

  it("adds a block from the day picker with the default range", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ value: null, onChange });

    await user.click(
      screen.getByRole("button", {
        name: "availability.editor.addBlock:availability.editor.dayMon",
      }),
    );
    /* 弹层带过渡动画，机器忙的时候挂载会晚一拍——用 find 而不是 get。 */
    await user.click(await screen.findByText("availability.editor.confirmAdd"));

    expect(screen.getByText("20:00–24:00")).toBeInTheDocument();
    expect(lastLocalDays(onChange).monday).toHaveLength(1);
  });

  it("survives a save/reload round trip for a block that ends at midnight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.weeknights"));
    const payload = onChange.mock.calls.at(-1)?.[0].availability;

    /* 读回落库的 UTC 值：结束时间跨过午夜会回到 00:00，不还原成 24:00 就会被当成
       空区间丢掉——旧的网格编辑器正是这样吃掉每段到午夜为止的时间。 */
    rerender(
      <AvailabilityEditor value={payload} onChange={onChange} />,
    );

    expect(screen.getAllByText("20:00–24:00")).toHaveLength(5);
  });

  it("removes a single block without touching the rest of the day", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.lateNight"));
    await user.click(screen.getByText("availability.editor.preset.everyEvening"));
    expect(lastLocalDays(onChange).monday).toHaveLength(2);

    await user.click(
      screen.getByRole("button", {
        name: "availability.editor.removeBlock:availability.editor.dayMon,00:00,03:00",
      }),
    );

    const localDays = lastLocalDays(onChange);
    expect(localDays.monday).toHaveLength(1);
    expect(localDays.tuesday).toHaveLength(2);
  });

  it("copies a day onto another day, merging with what is already there", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.weekends"));
    const copyButtons = screen.getAllByRole("button", { name: "availability.editor.copyTo" });
    await user.click(copyButtons[5]!);
    /* jsdom 没有布局，floating-ui 会隐藏 portal 菜单；这里只验证菜单内容和复制行为。 */
    const target = await screen.findByRole("menuitem", { name: "availability.editor.dayMon", hidden: true });
    await user.click(target);

    const localDays = lastLocalDays(onChange);
    expect(localDays.monday).toHaveLength(1);
    expect(localDays.saturday).toHaveLength(1);
  });

  it("moves both weekday and minute when local time crosses a UTC day boundary", () => {
    /* 偏移东为正：纽约 UTC−5 是 −300，上海 UTC+8 是 +480。 */
    const west = emptyDays();
    west.monday = [{ start: "20:00", end: "24:00" }];
    const westPayload = convertLocalDaysToAvailability(west, "America/New_York", -300);
    expect(westPayload?.days.tuesday).toEqual([{ start_utc: "01:00", end_utc: "05:00" }]);

    const east = emptyDays();
    east.monday = [{ start: "00:00", end: "03:00" }];
    const eastPayload = convertLocalDaysToAvailability(east, "Asia/Shanghai", 480);
    expect(eastPayload?.days.sunday).toEqual([{ start_utc: "16:00", end_utc: "19:00" }]);

    expect(convertAvailabilityToLocalDays(westPayload, -300).monday).toEqual(west.monday);
    expect(convertAvailabilityToLocalDays(eastPayload, 480).monday).toEqual(east.monday);
  });

  it("splits an API range that crosses midnight into local day rows", () => {
    const local = convertAvailabilityToLocalDays({
      timezone: "UTC",
      days: {
        sunday: [],
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [{ start_utc: "22:00", end_utc: "01:00" }],
        saturday: [],
      },
    }, 0);

    expect(local.friday).toEqual([{ start: "22:00", end: "24:00" }]);
    expect(local.saturday).toEqual([{ start: "00:00", end: "01:00" }]);
  });

  it("emits null when all availability is cleared", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ value: null, onChange });

    await user.click(screen.getByText("availability.editor.preset.lateNight"));
    await user.click(screen.getByText("availability.editor.clearAll"));

    expect(onChange).toHaveBeenLastCalledWith({ availability: null });
  });
});

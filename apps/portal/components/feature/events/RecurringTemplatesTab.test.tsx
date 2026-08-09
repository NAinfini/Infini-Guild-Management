// @vitest-environment jsdom
import type { RecurringTemplate } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringTemplatesTab } from "./RecurringTemplatesTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "recurring.editAria" ? `Edit ${options?.title}` : key,
    i18n: { language: "en" },
  }),
}));

class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  unobserve() {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1200 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function buildTemplate(overrides: Partial<RecurringTemplate>): RecurringTemplate {
  return {
    id: "template-1",
    type: "weekly_mission",
    title: "Weekly Mission",
    description: "Team strategy session",
    start_time: "12:00",
    duration_minutes: 60,
    capacity: 20,
    recurrence_rule: {
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [1],
    },
    visibility_offset_minutes: 0,
    auto_archive: false,
    attachments: [],
    class_quotas: [],
    paused: false,
    created_by: "user-1",
    last_generated_date: null,
    generation_count: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("RecurringTemplatesTab", () => {
  beforeEach(() => {
    window.ResizeObserver = WideResizeObserver as unknown as typeof ResizeObserver;
  });

  /*
   * 模板档不渲染 EventsFiltersCard，视图切换器改挂在这条工具栏上——这两条守的是
   * 那次并栏本身：切换器必须跟模板筛选项同处一个工具栏，而且在一个模板都没有时也得在，
   * 否则用户进得来出不去。
   */
  it("keeps the view switcher in the same toolbar as the template filters", () => {
    render(
      <MantineProvider>
        <RecurringTemplatesTab
          canManage
          onViewModeChange={vi.fn()}
          templates={[buildTemplate({})]}
          loading={false}
          formSaving={false}
          onCreateTemplate={vi.fn().mockResolvedValue(undefined)}
          onUpdateTemplate={vi.fn().mockResolvedValue(undefined)}
          onPauseTemplate={vi.fn().mockResolvedValue(undefined)}
          onResumeTemplate={vi.fn().mockResolvedValue(undefined)}
          onDeleteTemplate={vi.fn().mockResolvedValue(undefined)}
        />
      </MantineProvider>,
    );

    const switcher = screen.getByRole("radio", { name: "view.recurring" });
    const search = screen.getByRole("textbox", { name: "recurring.filter.search" });
    // 同一个 Paper 里 = 同一套工具栏；拆成两个卡片就是回到重复控制区。
    expect(switcher.closest(".mantine-Paper-root")).toBe(search.closest(".mantine-Paper-root"));
  });

  it("keeps the view switcher when there is not a single template yet", () => {
    render(
      <MantineProvider>
        <RecurringTemplatesTab
          canManage
          onViewModeChange={vi.fn()}
          templates={[]}
          loading={false}
          formSaving={false}
          onCreateTemplate={vi.fn().mockResolvedValue(undefined)}
          onUpdateTemplate={vi.fn().mockResolvedValue(undefined)}
          onPauseTemplate={vi.fn().mockResolvedValue(undefined)}
          onResumeTemplate={vi.fn().mockResolvedValue(undefined)}
          onDeleteTemplate={vi.fn().mockResolvedValue(undefined)}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("radio", { name: "view.cards" })).toBeInTheDocument();
    // 空列表没什么可筛的，筛选项该一起收起来。
    expect(screen.queryByRole("textbox", { name: "recurring.filter.search" })).not.toBeInTheDocument();
  });

  it("opens its create form directly from the empty state", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <RecurringTemplatesTab
          canManage
          onViewModeChange={vi.fn()}
          templates={[]}
          loading={false}
          formSaving={false}
          onCreateTemplate={vi.fn().mockResolvedValue(undefined)}
          onUpdateTemplate={vi.fn().mockResolvedValue(undefined)}
          onPauseTemplate={vi.fn().mockResolvedValue(undefined)}
          onResumeTemplate={vi.fn().mockResolvedValue(undefined)}
          onDeleteTemplate={vi.fn().mockResolvedValue(undefined)}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "recurring.create" }));

    expect(await screen.findByRole("dialog", { name: "recurring.create" })).toBeInTheDocument();
  });

  it("searches templates and filters them by status and event type", async () => {
    const user = userEvent.setup();
    const activeTemplate = buildTemplate({ id: "active", title: "Alpha Run" });
    const pausedTemplate = buildTemplate({
      id: "paused",
      type: "social",
      title: "Beta Social",
      description: "Guild meetup",
      paused: true,
    });

    render(
      <MantineProvider>
        <RecurringTemplatesTab
          canManage
          onViewModeChange={vi.fn()}
          templates={[activeTemplate, pausedTemplate]}
          loading={false}
          formSaving={false}
          onCreateTemplate={vi.fn().mockResolvedValue(undefined)}
          onUpdateTemplate={vi.fn().mockResolvedValue(undefined)}
          onPauseTemplate={vi.fn().mockResolvedValue(undefined)}
          onResumeTemplate={vi.fn().mockResolvedValue(undefined)}
          onDeleteTemplate={vi.fn().mockResolvedValue(undefined)}
        />
      </MantineProvider>,
    );

    const searchInput = screen.getByRole("textbox", { name: "recurring.filter.search" });
    await user.type(searchInput, "alpha");
    expect(screen.getByText("Alpha Run")).toBeInTheDocument();
    expect(screen.queryByText("Beta Social")).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.click(screen.getByRole("radio", { name: "recurring.status.paused" }));
    expect(screen.queryByText("Alpha Run")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Social")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "recurring.filter.all" }));
    await user.click(screen.getByRole("combobox", { name: "recurring.filter.type" }));
    fireEvent.click(screen.getByRole("option", { name: "Social", hidden: true }));
    expect(screen.queryByText("Alpha Run")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Social")).toBeInTheDocument();
  });

  it("opens editable template cards with Enter or Space without child controls bubbling", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <RecurringTemplatesTab
          canManage
          onViewModeChange={vi.fn()}
          templates={[buildTemplate({})]}
          loading={false}
          formSaving={false}
          onCreateTemplate={vi.fn().mockResolvedValue(undefined)}
          onUpdateTemplate={vi.fn().mockResolvedValue(undefined)}
          onPauseTemplate={vi.fn().mockResolvedValue(undefined)}
          onResumeTemplate={vi.fn().mockResolvedValue(undefined)}
          onDeleteTemplate={vi.fn().mockResolvedValue(undefined)}
        />
      </MantineProvider>,
    );

    const templateCard = screen.getByRole("button", { name: "Edit Weekly Mission" });
    templateCard.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: /recurring\.edit/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /recurring\.edit/ })).not.toBeInTheDocument(),
    );

    templateCard.focus();
    await user.keyboard(" ");
    expect(await screen.findByRole("dialog", { name: /recurring\.edit/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /recurring\.edit/ })).not.toBeInTheDocument(),
    );
    const statusControl = screen.getByRole("button", {
      name: "recurring.status.active",
    });
    await user.click(statusControl);
    expect(screen.queryByRole("dialog", { name: /recurring\.edit/ })).not.toBeInTheDocument();
  });
});

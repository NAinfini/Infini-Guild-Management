// @vitest-environment jsdom
import type { RecurringTemplate } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecurringTemplatesTab } from "./RecurringTemplatesTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

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
  it("opens its create form directly from the empty state", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <RecurringTemplatesTab
          canManage
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
    await user.click(screen.getByRole("textbox", { name: "recurring.filter.type" }));
    fireEvent.click(screen.getByRole("option", { name: "common:eventType.social", hidden: true }));
    expect(screen.queryByText("Alpha Run")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Social")).toBeInTheDocument();
  });
});

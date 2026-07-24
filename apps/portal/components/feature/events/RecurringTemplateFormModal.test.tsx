// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecurringTemplateFormModal } from "./RecurringTemplateFormModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "recurring.create": "Create recurring template",
        "recurring.edit": "Edit recurring template",
        "field.title": "Title",
        "filter.type": "Type",
        "recurring.field.startTime": "Start Time",
        "recurring.field.duration": "Duration",
        "field.capacity": "Capacity",
        "field.unlimited": "Unlimited",
        "field.description": "Description",
        "field.autoArchive": "Auto archive",
        "field.autoArchiveHint": "Archive after end",
        "field.interval": "Interval",
        "field.weekdays": "Weekdays",
        "field.monthDay": "Day of Month",
        "recurrence.endLabel": "Ends",
        "recurrence.endNever": "Never",
        "recurrence.endDate": "On date",
        "recurrence.endAfterLabel": "After count",
        "recurrence.endAfterSuffix": "times",
        "button.cancel": "Cancel",
        "button.save": "Save",
      };
      return labels[key] ?? key;
    },
  }),
}));

describe("RecurringTemplateFormModal", () => {
  it("resets form fields when editing a different template", async () => {
    const user = userEvent.setup();
    const firstTemplate = {
      id: "tpl-1",
      type: "raid",
      title: "First Template",
      description: "First description",
      start_time: "19:00",
      duration_minutes: null,
      capacity: 10,
      paused: false,
      recurrence_rule: {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1, 3],
      },
      visibility_offset_minutes: 0,
      generation_count: 0,
      last_generated_date: null,
      auto_archive: true,
      created_at: "2026-03-20T12:00:00.000Z",
      updated_at: "2026-03-20T12:00:00.000Z",
      created_by: "user-1",
      attachments: [],
    };
    const secondTemplate = {
      ...firstTemplate,
      id: "tpl-2",
      title: "Second Template",
      description: "Second description",
      capacity: 25,
    };

    const { rerender } = render(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="edit"
          template={firstTemplate as never}
          confirmLoading={false}
          onCancel={() => {}}
          onSave={() => {}}
        />
      </MantineProvider>,
    );

    const titleInput = screen.getByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "Mutated title");
    expect(screen.getByDisplayValue("Mutated title")).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="edit"
          template={secondTemplate as never}
          confirmLoading={false}
          onCancel={() => {}}
          onSave={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByDisplayValue("Second Template")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Mutated title")).not.toBeInTheDocument();
  });

  it("includes auto-archive setting in saved template payloads", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="create"
          template={null}
          confirmLoading={false}
          onCancel={() => {}}
          onSave={onSave}
        />
      </MantineProvider>,
    );

    await user.type(screen.getByLabelText("Title"), "Daily Run");
    await user.click(screen.getAllByLabelText("Type")[0]!);
    await user.click(await screen.findByText("common:eventType.social"));
    await user.type(screen.getByLabelText("Start Time"), "10:00");
    await user.click(screen.getByText("Auto archive"));
    await user.click(screen.getByRole("button", { name: "Create recurring template" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ auto_archive: true }));
  });
});

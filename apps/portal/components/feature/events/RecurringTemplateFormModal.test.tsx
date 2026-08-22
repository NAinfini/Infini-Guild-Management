import { MantineProvider } from "@mantine/core";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RecurringTemplate } from "@guild/shared";
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
        "recurring.pause": "Pause",
        "recurring.resume": "Resume",
      };
      return labels[key] ?? key;
    },
    // 右栏那张产物卡走的是真的 EventCardView，它按 i18n.language 格式化日期。
    i18n: { language: "en" },
  }),
}));

describe("RecurringTemplateFormModal", () => {
  it("disables submission until title, start time, and event type are valid", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="create"
          template={null}
          confirmLoading={false}
          onCancel={() => {}}
          onSave={() => {}}
        />
      </MantineProvider>,
    );

    const createButton = screen.getByRole("button", { name: "Create recurring template" });
    expect(createButton).toBeDisabled();

    await user.type(screen.getByLabelText("Title"), "Daily Run");
    expect(createButton).toBeDisabled();

    await user.click(screen.getAllByLabelText("Type")[0]!);
    await user.click(await screen.findByText("Social"));
    expect(createButton).toBeEnabled();

    await user.clear(screen.getByLabelText("Start Time"));
    expect(createButton).toBeDisabled();

    await user.type(screen.getByLabelText("Start Time"), "10:00");
    expect(createButton).toBeEnabled();
  });

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

  it("sends explicit supported clear values and a zero visibility offset", async () => {
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
    await user.click(await screen.findByText("Social"));
    await user.type(screen.getByLabelText("Start Time"), "10:00");
    await user.click(screen.getByText("Auto archive"));
    await user.click(screen.getByRole("button", { name: "Create recurring template" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      auto_archive: true,
      description: "",
      visibility_offset_minutes: 0,
    }));
  });

  it("sends null for cleared template fields when updating", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const template = {
      id: "tpl-1",
      type: "social",
      title: "Weekly Run",
      description: "Old description",
      start_time: "19:00",
      duration_minutes: 120,
      capacity: 20,
      paused: false,
      recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: [3] },
      visibility_offset_minutes: 0,
      generation_count: 0,
      last_generated_date: null,
      auto_archive: false,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      created_by: "user-1",
      attachments: [],
      class_quotas: [],
    } as RecurringTemplate;

    render(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="edit"
          template={template}
          confirmLoading={false}
          onCancel={() => {}}
          onSave={onSave}
        />
      </MantineProvider>,
    );

    await user.clear(screen.getByLabelText("Description"));
    await user.clear(screen.getByLabelText("Duration"));
    await user.clear(screen.getByLabelText("Capacity"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      description: null,
      duration_minutes: null,
      capacity: null,
    }));
  });

  it("waits for lifecycle actions and keeps the modal open when they fail", async () => {
    const user = userEvent.setup();
    let resolvePause: (() => void) | undefined;
    let resolveResume: (() => void) | undefined;
    const onPause = vi.fn(() => new Promise<void>((resolve) => { resolvePause = resolve; }));
    const onResume = vi.fn(() => new Promise<void>((resolve) => { resolveResume = resolve; }));
    const onDelete = vi.fn().mockRejectedValue(new Error("delete failed"));
    const onCancel = vi.fn();
    const activeTemplate = {
      id: "tpl-1",
      type: "social",
      title: "Weekly Run",
      description: null,
      start_time: "19:00",
      duration_minutes: null,
      capacity: null,
      paused: false,
      recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: [3] },
      visibility_offset_minutes: 0,
      generation_count: 0,
      last_generated_date: null,
      auto_archive: false,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      created_by: "user-1",
      attachments: [],
      class_quotas: [],
    } as RecurringTemplate;

    const { rerender } = render(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="edit"
          template={activeTemplate}
          confirmLoading={false}
          onCancel={onCancel}
          onSave={() => {}}
          onPause={onPause}
          onResume={onResume}
          onDelete={onDelete}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledWith("tpl-1");
    expect(onCancel).not.toHaveBeenCalled();
    resolvePause?.();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));

    rerender(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="edit"
          template={{ ...activeTemplate, paused: true }}
          confirmLoading={false}
          onCancel={onCancel}
          onSave={() => {}}
          onPause={onPause}
          onResume={onResume}
          onDelete={onDelete}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalledWith("tpl-1");
    expect(onCancel).toHaveBeenCalledTimes(1);
    resolveResume?.();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));

    rerender(
      <MantineProvider>
        <RecurringTemplateFormModal
          open
          mode="edit"
          template={activeTemplate}
          confirmLoading={false}
          onCancel={onCancel}
          onSave={() => {}}
          onPause={onPause}
          onResume={onResume}
          onDelete={onDelete}
        />
      </MantineProvider>,
    );

    onPause.mockRejectedValueOnce(new Error("pause failed"));
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onPause).toHaveBeenCalledTimes(2));
    expect(onCancel).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "recurring.delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("tpl-1"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { RecurringTemplateFormContent } from "./RecurringTemplateFormContent";
import type { RecurringTemplate } from "@guild/shared";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "recurring.create": "Create recurring template",
      "field.title": "Title",
      "filter.type": "Type",
      "recurring.field.startTime": "Start Time",
      "recurring.field.durationUnitLabel": "Duration unit",
      "button.cancel": "Cancel",
    }[key] ?? key),
    i18n: { language: "en" },
  }),
}));

function renderForm(
  onDirtyChange = vi.fn(),
  media: Partial<Pick<
    ComponentProps<typeof RecurringTemplateFormContent>,
    "attachmentItems" | "onAttachmentsChange" | "onFilesSelected" | "onAttachmentDelete"
  >> = {},
) {
  return render(
    <>
      <RecurringTemplateFormContent
        mode="create"
        template={null}
        confirmLoading={false}
        onCancel={() => {}}
        onSave={() => {}}
        attachmentItems={media.attachmentItems ?? []}
        onAttachmentsChange={media.onAttachmentsChange ?? vi.fn()}
        onFilesSelected={media.onFilesSelected ?? vi.fn()}
        onAttachmentDelete={media.onAttachmentDelete ?? vi.fn()}
        onDirtyChange={onDirtyChange}
        stickyActions
      />
    </>,
  );
}

function createTemplate(overrides: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    id: "tpl-1",
    type: "social",
    title: "Weekly Raid",
    description: null,
    start_time: "04:30",
    duration_minutes: null,
    capacity: null,
    recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: [3] },
    visibility_offset_minutes: 0,
    auto_archive: false,
    attachments: [],
    class_quotas: [],
    paused: false,
    created_by: "user-1",
    last_generated_date: null,
    generation_count: 0,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("RecurringTemplateFormContent", () => {
  it("keeps the route form disabled until the required fields are ready", async () => {
    const user = userEvent.setup();
    renderForm();

    const createButton = screen.getByRole("button", { name: "Create recurring template" });
    expect(createButton).toBeDisabled();

    await user.type(screen.getByLabelText("Title"), "Daily Run");
    await user.selectOptions(screen.getByLabelText("Type"), "social");
    await user.type(screen.getByLabelText("Start Time"), "10:00");

    expect(screen.getByLabelText("Duration unit")).toHaveValue("hours");
    expect(createButton).toBeEnabled();
  });

  it("reports a dirty route form and uses visible sticky actions", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderForm(onDirtyChange);

    await user.type(screen.getByLabelText("Title"), "Dirty template");

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(document.querySelector(".rtf-actions--sticky")).toBeInTheDocument();
  });

  it("shows saved template images and forwards newly selected files", () => {
    const onFilesSelected = vi.fn();
    const view = renderForm(vi.fn(), {
      attachmentItems: [{ id: "media-1", src: "/api/media/media-1", alt: "Template image 1" }],
      onFilesSelected,
    });

    expect(screen.getByRole("img", { name: "Template image 1" })).toBeInTheDocument();
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["image"], "raid.png", { type: "image/png" });
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it("preserves a dirty draft when the same template is refreshed", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const template = createTemplate();
    const view = render(
      <>
        <RecurringTemplateFormContent
          mode="edit"
          template={template}
          confirmLoading={false}
          onCancel={() => {}}
          onSave={() => {}}
          attachmentItems={[]}
          onAttachmentsChange={vi.fn()}
          onFilesSelected={vi.fn()}
          onAttachmentDelete={vi.fn()}
          onDirtyChange={onDirtyChange}
        />
      </>,
    );

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Unsaved Draft");

    view.rerender(
      <>
        <RecurringTemplateFormContent
          mode="edit"
          template={createTemplate({ title: "Server Refresh", updated_at: "2026-07-02T12:00:00.000Z" })}
          confirmLoading={false}
          onCancel={() => {}}
          onSave={() => {}}
          attachmentItems={[]}
          onAttachmentsChange={vi.fn()}
          onFilesSelected={vi.fn()}
          onAttachmentDelete={vi.fn()}
          onDirtyChange={onDirtyChange}
        />
      </>,
    );

    expect(screen.getByLabelText("Title")).toHaveValue("Unsaved Draft");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});

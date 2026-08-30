import type { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { EventFormContent } from "../../components/feature/events/EventFormContent";
import { AttachmentService } from "../../services/AttachmentService";
import { EventService } from "../../services/EventService";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        "editor.createTitle": "Create Event",
        "editor.editTitle": "Edit Event",
        "field.title": "Title",
        "filter.type": "Type",
        "field.start": "Start",
        "field.end": "End",
        "field.capacity": "Capacity",
        "field.unlimited": "Unlimited",
        "field.description": "Description",
        "button.cancel": "Cancel",
        "button.create": "Create",
        "button.save": "Save",
      };
      if (key === "field.attachmentsCount") {
        return `${params?.current ?? 0}/${params?.max ?? 0}`;
      }
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("../../components/shared/ImageGridEditor", () => ({
  ImageGridEditor: ({
    items,
    onFilesSelected,
  }: {
    items: Array<{ id: string; alt?: string }>;
    onFilesSelected?: (files: File[]) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onFilesSelected?.([new File(["image"], "poster.png", { type: "image/png" })])
        }
      >
        Upload Images
      </button>
      {items.map((item) => (
        <div key={item.id}>{item.alt ?? item.id}</div>
      ))}
    </div>
  ),
}));

function EventCreationHarness({
  createEvent,
}: {
  createEvent: ReturnType<typeof vi.fn>;
}) {
  const attachmentService = new AttachmentService();
  const eventService = new EventService({
    attachmentService,
    queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } as unknown as QueryClient,
    createEvent: createEvent as never,
    updateEvent: vi.fn(),
  });
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<"social">("social");
  const [startAt, setStartAt] = useState("2026-03-20T19:00");
  const [endAt, setEndAt] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [description, setDescription] = useState("Bring food");
  const [autoArchive, setAutoArchive] = useState(false);
  const [attachmentItems, setAttachmentItems] = useState<Array<{ id: string; src?: string; alt?: string; file?: File }>>([]);

  return (
      <EventFormContent
        mode="create"
        canManage
        title={title}
        onTitleChange={setTitle}
        eventType={eventType}
        onEventTypeChange={(value) => setEventType(value as "social")}
        startAt={startAt}
        onStartAtChange={setStartAt}
        endAt={endAt}
        onEndAtChange={setEndAt}
        capacity={capacity}
        onCapacityChange={setCapacity}
        description={description}
        onDescriptionChange={setDescription}
        autoArchive={autoArchive}
        onAutoArchiveChange={setAutoArchive}
        classQuotas={[]}
        onClassQuotasChange={() => {}}
        attachmentItems={attachmentItems}
        onAttachmentsChange={setAttachmentItems}
        onFilesSelected={(files) => {
          void attachmentService.prepareFiles(files).then((prepared) => {
            setAttachmentItems((current) => [...current, ...prepared]);
          });
        }}
        onAttachmentDelete={() => {}}
        availabilityDaysWithAny={new Set<number>()}
        availabilityMaxCount={0}
        availabilityMemberCount={0}
        confirmLoading={false}
        onCancel={() => {}}
        onSave={() => {
          void eventService.saveEvent({
            mode: "create",
            editingEventId: null,
            expectedUpdatedAt: null,
            eventType,
            title,
            description,
            startAt,
            startIso: "2026-03-20T19:00:00.000Z",
            endAt,
            endIso: null,
            capacity,
            pinned: false,
            signupLocked: false,
            autoArchive,
            attachmentItems,
          });
        }}
      />
  );
}

describe("event creation flow", () => {
  it("creates an event with attachment files through the editor workflow", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:poster");
    const createEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const user = userEvent.setup();

    render(<EventCreationHarness createEvent={createEvent} />);

    await user.type(screen.getByLabelText("Title"), "Guild Run");
    await user.click(screen.getByRole("button", { name: "Upload Images" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Guild Run",
          start_at: "2026-03-20T19:00:00.000Z",
        }),
        [expect.any(File)],
      );
    });
  });
});

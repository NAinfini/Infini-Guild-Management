// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createElement, forwardRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { EventFormModal } from "../../components/feature/events/EventFormModal";
import { AttachmentService } from "../../services/AttachmentService";
import { EventService } from "../../services/EventService";

vi.mock("motion/react", () => {
  const motionProps = new Set(["initial", "animate", "exit", "transition", "variants", "whileHover", "whileTap", "whileFocus", "whileDrag", "whileInView", "layout", "layoutId", "onAnimationStart", "onAnimationComplete", "onLayoutAnimationStart", "onLayoutAnimationComplete", "dragListener", "dragControls"]);
  function filterProps(props: Record<string, unknown>) {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (!motionProps.has(k)) filtered[k] = v;
    }
    return filtered;
  }
  const makeComponent = (tag: string) => forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    const { children, ...rest } = props;
    return createElement(tag, { ...filterProps(rest), ref }, children as ReactNode);
  });
  const motionProxy = new Proxy({} as Record<string, ReturnType<typeof makeComponent>>, {
    get: (_target, prop: string) => makeComponent(prop),
  });
  const ReorderGroup = forwardRef<HTMLDivElement, Record<string, unknown>>(({ children, axis: _a, values: _v, onReorder: _o, ...rest }, ref) =>
    createElement("div", { ...filterProps(rest), ref }, children as ReactNode));
  const ReorderItem = forwardRef<HTMLDivElement, Record<string, unknown>>(({ children, value: _val, ...rest }, ref) =>
    createElement("div", { ...filterProps(rest), ref }, children as ReactNode));
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children: ReactNode }) => createElement("div", null, children),
    Reorder: { Group: ReorderGroup, Item: ReorderItem },
    useDragControls: () => ({ start: vi.fn() }),
    useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        "modal.createTitle": "Create Event",
        "modal.editTitle": "Edit Event",
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
    onDelete,
  }: {
    items: Array<{ id: string; alt?: string }>;
    onFilesSelected?: (files: File[]) => void;
    onDelete?: (item: { id: string; alt?: string }) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onFilesSelected?.([new File(["image"], "new.png", { type: "image/png" })])
        }
      >
        Upload Images
      </button>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onDelete?.(item)}>
          Delete {item.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@guild/shared/utils/media", () => ({
  convertFileForUpload: vi.fn(async (file: File) => file),
  convertFilesForUpload: vi.fn(async (files: readonly File[]) => [...files]),
  DEFAULT_IMAGE_WEBP_QUALITY: 0.82,
}));

function EventEditHarness({
  updateEvent,
  uploadEventImages,
}: {
  updateEvent: ReturnType<typeof vi.fn>;
  uploadEventImages: ReturnType<typeof vi.fn>;
}) {
  const attachmentService = new AttachmentService();
  const eventService = new EventService({
    attachmentService,
    queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } as unknown as QueryClient,
    createEvent: vi.fn(),
    updateEvent: updateEvent as never,
    uploadEventImages: uploadEventImages as never,
  });
  const [attachmentItems, setAttachmentItems] = useState<Array<{ id: string; src?: string; alt?: string; file?: File }>>([
    { id: "events/existing.png", src: "events/existing.png", alt: "Existing" },
  ]);

  return (
    <MantineProvider>
      <EventFormModal
        open
        mode="edit"
        canManage
        title="Guild Review"
        onTitleChange={() => {}}
        eventType="social"
        onEventTypeChange={() => {}}
        startAt="2026-03-22T20:00"
        onStartAtChange={() => {}}
        endAt=""
        onEndAtChange={() => {}}
        capacity=""
        onCapacityChange={() => {}}
        description=""
        onDescriptionChange={() => {}}
        autoArchive={false}
        onAutoArchiveChange={() => {}}
        classQuotas={[]}
        onClassQuotasChange={() => {}}
        attachmentItems={attachmentItems}
        onAttachmentsChange={setAttachmentItems}
        onFilesSelected={(files) => {
          void attachmentService.prepareFiles(files).then((prepared) => {
            setAttachmentItems((current) => [...current, ...prepared]);
          });
        }}
        onAttachmentDelete={(item) => {
          attachmentService.releaseItem(item);
          setAttachmentItems((current) => current.filter((candidate) => candidate.id !== item.id));
        }}
        availabilityDaysWithAny={new Set<number>()}
        availabilityMaxCount={0}
        availabilityMemberCount={0}
        confirmLoading={false}
        onCancel={() => {}}
        onSave={() => {
          void eventService.saveEvent({
            mode: "edit",
            editingEventId: "evt-1",
            eventType: "social",
            title: "Guild Review",
            description: "",
            startAt: "2026-03-22T20:00",
            startIso: "2026-03-22T20:00:00.000Z",
            endAt: "",
            endIso: null,
            capacity: "",
            pinned: true,
            signupLocked: true,
            autoArchive: false,
            attachmentItems,
          });
        }}
      />
    </MantineProvider>
  );
}

describe("event edit flow", () => {
  it("uploads new files and preserves existing attachments during edit", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:new");
    const uploadEventImages = vi.fn().mockResolvedValue({
      keys: ["events/new.png"],
      attachments: ["events/existing.png", "events/new.png"],
    });
    const updateEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const user = userEvent.setup();

    render(<EventEditHarness updateEvent={updateEvent} uploadEventImages={uploadEventImages} />);

    await user.click(screen.getByRole("button", { name: "Upload Images" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(uploadEventImages).toHaveBeenCalledWith("evt-1", [expect.any(File)]);
      expect(updateEvent).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          attachments: ["events/existing.png", "events/new.png"],
          pinned: true,
          signup_locked: true,
        }),
      );
    });
  });
});

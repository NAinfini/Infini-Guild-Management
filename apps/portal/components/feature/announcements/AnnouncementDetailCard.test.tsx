import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementDetailCard } from "./AnnouncementDetailCard";

const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: () => <div data-testid="tiptap-editor" />,
  buildTipTapEditorLabels: () => ({}),
}));

function renderCreateEditor() {
  return render(
    <AnnouncementDetailCard
        navigation={<button type="button">Back to announcements</button>}
        title="Create"
        canEdit
        canCreate
        canArchive
        canDelete
        selectedId="new"
        selected={null}
        isLoading={false}
        savePending={false}
        titleValue=""
        onTitleChange={() => {}}
        category="announcement"
        onCategoryChange={() => {}}
        bodyJson="{}"
        onBodyJsonChange={() => {}}
        pinned={false}
        onPinnedChange={() => {}}
        publishAt=""
        onPublishAtChange={() => {}}
        onStartEditing={() => {}}
        onFinish={async () => true}
        onDelete={async () => true}
        onCloseEditor={() => {}}
        archivePending={false}
        deletePending={false}
        onImageUpload={async () => ""}
        attachments={[]}
        attachmentUploading={false}
        attachmentMaxBytes={10 * 1024 * 1024}
        attachmentQuota={5}
        onAttachmentUpload={async () => {}}
        onAttachmentRemove={() => {}}
        isDirty={false}
        isPublishReady={false}
        emptyTitle="No announcement"
    />,
  );
}

function renderReader(overrides: Partial<ComponentProps<typeof AnnouncementDetailCard>> = {}) {
  const selected = {
    id: "announcement-1",
    title: "Guild Update",
    category: "important" as const,
    view_count: 12,
    excerpt: "Guild update summary",
    preview_media_id: "preview-media",
    body_json: "{}",
    pinned: true,
    status: "published" as const,
    publish_at: null,
    expires_at: null,
    archived_at: null,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    author: {
      id: "user-1",
      display_name: "Guild Keeper",
      avatar_media_id: null,
    },
    attachments: [{
      media_id: "media1234567890abcdef",
      name: "guild-guide.pdf",
      content_type: "application/pdf" as const,
      byte_size: 2_400_000,
    }],
  };
  return render(
    <AnnouncementDetailCard
        navigation={<button type="button">Back to announcements</button>}
        title="Announcement Detail"
        canEdit
        canCreate
        canArchive
        canDelete
        selectedId={selected.id}
        selected={selected}
        isLoading={false}
        savePending={false}
        titleValue={selected.title}
        onTitleChange={() => {}}
        category={selected.category}
        onCategoryChange={() => {}}
        bodyJson={selected.body_json}
        onBodyJsonChange={() => {}}
        pinned={false}
        onPinnedChange={() => {}}
        publishAt=""
        onPublishAtChange={() => {}}
        onStartEditing={() => {}}
        onFinish={async () => true}
        onDelete={async () => true}
        onCloseEditor={() => {}}
        archivePending={false}
        deletePending={false}
        onImageUpload={async () => ""}
        attachments={selected.attachments}
        attachmentUploading={false}
        attachmentMaxBytes={10 * 1024 * 1024}
        attachmentQuota={5}
        onAttachmentUpload={async () => {}}
        onAttachmentRemove={() => {}}
        isDirty={false}
        isPublishReady
        emptyTitle="No announcement"
        {...overrides}
    />,
  );
}

describe("AnnouncementDetailCard", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  it("does not render an expiration time input in the announcement editor", () => {
    renderCreateEditor();

    expect(screen.queryByLabelText("aria.expireTime")).not.toBeInTheDocument();
    expect(screen.queryByText("field.expiresAt")).not.toBeInTheDocument();
  });

  it("does not render the schedule section label above publish time", () => {
    renderCreateEditor();

    expect(screen.queryByText("section.schedule")).not.toBeInTheDocument();
    expect(screen.getByText("field.publishAt")).toBeInTheDocument();
  });

  it("lets the native file picker select every attachment format", () => {
    const { container } = renderCreateEditor();

    expect(container.querySelector('input[type="file"]')).not.toHaveAttribute("accept");
  });

  it("renders the translated category label for the selected editor value", () => {
    renderCreateEditor();

    expect(screen.getByRole("combobox", { name: "aria.category" }))
      .toHaveTextContent("category.announcement");
  });

  it("marks a blank announcement as not ready and disables publishing", () => {
    renderCreateEditor();

    expect(screen.getByText("status.notReady")).toBeInTheDocument();
    expect(screen.queryByText("status.saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.publish" })).toBeDisabled();
  });

  it("does not expose the create editor when create permission is absent", () => {
    render(
      <AnnouncementDetailCard
        navigation={<button type="button">Back to announcements</button>}
        title="Create"
        canEdit
        canCreate={false}
        canArchive={false}
        canDelete={false}
        selectedId="new"
        selected={null}
        isLoading={false}
        savePending={false}
        titleValue=""
        onTitleChange={() => {}}
        category="announcement"
        onCategoryChange={() => {}}
        bodyJson="{}"
        onBodyJsonChange={() => {}}
        pinned={false}
        onPinnedChange={() => {}}
        publishAt=""
        onPublishAtChange={() => {}}
        onStartEditing={() => {}}
        onFinish={async () => true}
        onDelete={async () => true}
        onCloseEditor={() => {}}
        archivePending={false}
        deletePending={false}
        onImageUpload={async () => ""}
        attachments={[]}
        attachmentUploading={false}
        attachmentMaxBytes={10 * 1024 * 1024}
        attachmentQuota={5}
        onAttachmentUpload={async () => {}}
        onAttachmentRemove={() => {}}
        isDirty={false}
        isPublishReady={false}
        emptyTitle="No announcement"
      />,
    );

    expect(screen.queryByRole("textbox", { name: "aria.title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "action.publish" })).not.toBeInTheDocument();
  });

  it("blocks save actions while an attachment upload is in flight", () => {
    renderReader({ attachmentUploading: true });
    fireEvent.click(screen.getByRole("button", { name: "action.edit" }));

    expect(screen.getByRole("button", { name: "action.publish" })).toBeDisabled();
    expect(screen.getByRole("button", {
      name: "action.saveAsDraft / action.postScheduled",
    })).toBeDisabled();
  });

  it("uses one structured reader header with category before status and separate metadata labels", async () => {
    renderReader();

    expect(screen.queryByText("Announcement Detail")).not.toBeInTheDocument();
    const heading = await screen.findByRole("heading", { level: 2, name: "Guild Update" });
    const header = heading.closest(".content-detail-header");
    expect(header).not.toBeNull();
    expect(header).toContainElement(screen.getByRole("button", { name: "action.edit" }));
    expect(header).toHaveTextContent("status.pinned");
    expect(header).toHaveTextContent("category.important");
    expect(header).toHaveTextContent("meta.author");
    expect(header).toHaveTextContent("meta.viewsLabel");
    expect(header).toHaveTextContent("meta.releaseTimeLabel");
    expect(header).not.toHaveTextContent("meta.scheduled");
    expect(header).not.toHaveTextContent("meta.published");
    expect(screen.queryByText("meta.updated")).not.toBeInTheDocument();
    expect(header).toHaveTextContent("Guild Keeper");
    expect(header?.querySelector("data")).toHaveAttribute("value", "12");
    expect(screen.getByText("category.important").compareDocumentPosition(screen.getByText("status.pinned")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("guild-guide.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "action.downloadAttachment" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/media/media1234567890abcdef/full"),
    );
  });

  it("keeps navigation inside the detail card without repeating the preview image beside the title", () => {
    const { container } = renderReader();
    const detailCard = container.querySelector(".announcements-detail-card");
    const backButton = screen.getByRole("button", { name: "Back to announcements" });

    expect(detailCard).toContainElement(backButton);
    expect(backButton.closest(".content-detail-header__navigation")).not.toBeNull();
    expect(container.querySelector(".announcement-reader-hero")).not.toBeInTheDocument();
    expect(container.querySelector(".announcement-reader-cover")).not.toBeInTheDocument();
    expect(container.querySelector(".content-detail-header__cover")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Guild Update" })).toBeInTheDocument();
    expect(screen.getByText("Guild Keeper")).toBeInTheDocument();
  });

  it("keeps the editor open when saving fails", async () => {
    const onFinish = vi.fn().mockResolvedValue(false);
    renderReader({ onFinish });

    fireEvent.click(screen.getByRole("button", { name: "action.edit" }));
    fireEvent.click(screen.getByRole("button", { name: "action.publish" }));

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("none"));
    expect(screen.getByRole("textbox", { name: "aria.title" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "action.edit" })).not.toBeInTheDocument();
  });

  it("archives through confirmation and closes only after the mutation succeeds", async () => {
    const onFinish = vi.fn().mockResolvedValue(true);
    renderReader({ onFinish });

    fireEvent.click(screen.getByRole("button", { name: "action.edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "action.archive" }));

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("archived"));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "modal.archiveAnnouncement",
      description: "confirm.archive",
    }));
    expect(screen.getByRole("button", { name: "action.edit" })).toBeInTheDocument();
  });

  it("uses switches for editor pin and archive controls", () => {
    const onPinnedChange = vi.fn();
    renderReader({ onPinnedChange });

    fireEvent.click(screen.getByRole("button", { name: "action.edit" }));
    const pinSwitch = screen.getByRole("switch", { name: "action.pin" });
    const archiveSwitch = screen.getByRole("switch", { name: "action.archive" });

    expect(pinSwitch).not.toBeChecked();
    expect(archiveSwitch).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "action.pin" })).not.toBeInTheDocument();
    fireEvent.click(pinSwitch);
    expect(onPinnedChange).toHaveBeenCalledWith(true);
  });

  it("keeps archive-only and delete-only roles on their dedicated reader actions", async () => {
    const onFinish = vi.fn().mockResolvedValue(true);
    const onDelete = vi.fn().mockResolvedValue(true);
    renderReader({
      canEdit: false,
      canCreate: false,
      canArchive: true,
      canDelete: true,
      onFinish,
      onDelete,
    });

    expect(screen.queryByRole("button", { name: "action.edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "aria.title" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "action.archive" }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("archived"));

    fireEvent.click(screen.getByRole("button", { name: "action.delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnouncementDetailCard } from "./AnnouncementDetailCard";

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
  render(
    <AnnouncementDetailCard
        title="Create"
        canEdit
        selectedId="new"
        selected={null}
        isLoading={false}
        isError={false}
        warningMessage="Load failed"
        savePending={false}
        titleValue=""
        onTitleChange={() => {}}
        bodyJson="{}"
        onBodyJsonChange={() => {}}
        pinned={false}
        onPinnedChange={() => {}}
        scheduleEnabled={false}
        onScheduleEnabledChange={() => {}}
        publishAt=""
        onPublishAtChange={() => {}}
        onFinish={() => {}}
        onDelete={() => {}}
        onCloseEditor={() => {}}
        deletePending={false}
        draftEnabled={false}
        onDraftEnabledChange={() => {}}
        archived={false}
        onArchivedChange={() => {}}
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

function renderReader() {
  const selected = {
    id: "announcement-1",
    title: "Guild Update",
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
  render(
    <AnnouncementDetailCard
        title="Announcement Detail"
        canEdit
        selectedId={selected.id}
        selected={selected}
        isLoading={false}
        isError={false}
        warningMessage="Load failed"
        savePending={false}
        titleValue={selected.title}
        onTitleChange={() => {}}
        bodyJson={selected.body_json}
        onBodyJsonChange={() => {}}
        pinned={false}
        onPinnedChange={() => {}}
        scheduleEnabled={false}
        onScheduleEnabledChange={() => {}}
        publishAt=""
        onPublishAtChange={() => {}}
        onFinish={() => {}}
        onDelete={() => {}}
        onCloseEditor={() => {}}
        deletePending={false}
        draftEnabled={false}
        onDraftEnabledChange={() => {}}
        archived={false}
        onArchivedChange={() => {}}
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
    />,
  );
}

describe("AnnouncementDetailCard", () => {
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

  it("marks a blank announcement as not ready and disables publishing", () => {
    renderCreateEditor();

    expect(screen.getByText("status.notReady")).toBeInTheDocument();
    expect(screen.queryByText("status.saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.publish" })).toBeDisabled();
  });

  it("uses the article h2 and edit action as one reader header without a generic detail title", async () => {
    renderReader();

    expect(screen.queryByText("Announcement Detail")).not.toBeInTheDocument();
    const heading = await screen.findByRole("heading", { level: 2, name: "Guild Update" });
    const header = heading.closest(".announcement-reader-header");
    expect(header).not.toBeNull();
    expect(header).toContainElement(screen.getByRole("button", { name: "action.edit" }));
    expect(header).toHaveTextContent("status.important");
    expect(header).toHaveTextContent("Guild Keeper");
    expect(screen.getByText("guild-guide.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "action.downloadAttachment" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/media/media1234567890abcdef/full"),
    );
  });
});

// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
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
    <MantineProvider>
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
        isDirty={false}
        emptyTitle="No announcement"
      />
    </MantineProvider>,
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
});

import type { ImportantNotice } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@portal/api/query-keys";
import { AdminImportantNoticesSection, draftFromNotice } from "./AdminImportantNoticesSection";

const mocks = vi.hoisted(() => ({
  fetchAdminImportantNotices: vi.fn(),
  fetchImportantNoticeAudienceRoles: vi.fn(),
  updateAdminImportantNotice: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@portal/api/queries/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@portal/api/queries/notifications")>()),
  fetchAdminImportantNotices: mocks.fetchAdminImportantNotices,
  fetchImportantNoticeAudienceRoles: mocks.fetchImportantNoticeAudienceRoles,
}));

vi.mock("@portal/api/mutations/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@portal/api/mutations/notifications")>()),
  updateAdminImportantNotice: mocks.updateAdminImportantNotice,
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <div role="textbox" aria-label={ariaLabel} data-testid="tiptap-editor">{value}</div>
  ),
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock("@portal/hooks/useAppError", () => ({ useAppError: () => ({ showError: vi.fn() }) }));
vi.mock("@portal/utils/notifications", () => ({ notifySuccess: vi.fn() }));

const notice: ImportantNotice = {
  id: "notice-1",
  title: "A draft notice",
  body_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
  status: "draft",
  publish_at: null,
  expires_at: null,
  publication_revision: 0,
  requires_acknowledgement: false,
  audience_scope: "all",
  audience_role_ids: [],
  revision_token: "notice-1-revision-1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AdminImportantNoticesSection />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("AdminImportantNoticesSection", () => {
  beforeEach(() => {
    mocks.fetchAdminImportantNotices.mockReset().mockResolvedValue([notice]);
    mocks.fetchImportantNoticeAudienceRoles.mockReset().mockResolvedValue([
      { id: "role-member", name: "Member", color: null, level: 10 },
      { id: "role-officer", name: "Officer", color: "#748ffc", level: 50 },
    ]);
    mocks.updateAdminImportantNotice.mockReset().mockResolvedValue({
      ...notice,
      title: "Local edit",
      revision_token: "notice-1-revision-3",
    });
  });

  it("clears a withdrawn notice's passed publication time before it is edited for a new release", () => {
    const withdrawn = {
      ...notice,
      status: "withdrawn" as const,
      publish_at: "2020-08-01T00:00:00.000Z",
      expires_at: "2020-08-02T00:00:00.000Z",
    };

    expect(draftFromNotice(withdrawn)).toMatchObject({ publishAt: "", expiresAt: "" });
  });

  it("opens the first notice so the list and editor are visible together", async () => {
    renderSection();

    await screen.findByText("A draft notice");

    expect(await screen.findByDisplayValue("A draft notice")).toHaveAccessibleName("importantNotices.field.title");
  });

  it("keeps cached notices visible after a failed refresh", async () => {
    mocks.fetchAdminImportantNotices
      .mockResolvedValueOnce([notice])
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    const queryClient = renderSection();

    expect(await screen.findByText("A draft notice")).toBeInTheDocument();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.importantNotices.admin() });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("loadError");
    expect(screen.getAllByText("A draft notice").length).toBeGreaterThan(0);
  });

  it("disables publishing when the selected notice has unsaved edits", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByText("A draft notice"));
    const title = screen.getByRole("textbox", { name: "importantNotices.field.title" });
    await user.clear(title);
    await user.type(title, "Edited but unsaved");

    expect(screen.getByRole("button", { name: "importantNotices.action.publish" })).toBeDisabled();
    expect(screen.getByText("importantNotices.unsavedBeforePublish")).toBeInTheDocument();
  });

  it("preserves the open draft and sends its original revision after a background refresh", async () => {
    const user = userEvent.setup();
    const queryClient = renderSection();
    await screen.findByDisplayValue("A draft notice");
    const title = screen.getByRole("textbox", { name: "importantNotices.field.title" });
    await user.clear(title);
    await user.type(title, "Local edit");

    act(() => {
      queryClient.setQueryData(queryKeys.importantNotices.admin(), [{
        ...notice,
        title: "Remote edit",
        revision_token: "notice-1-revision-2",
      }]);
    });

    expect(title).toHaveValue("Local edit");
    await user.click(screen.getByRole("button", { name: "importantNotices.action.save" }));
    await waitFor(() => expect(mocks.updateAdminImportantNotice).toHaveBeenCalledTimes(1));
    expect(mocks.updateAdminImportantNotice).toHaveBeenCalledWith("notice-1", {
      expected_revision_token: "notice-1-revision-1",
      title: "Local edit",
      body_json: notice.body_json,
      publish_at: null,
      expires_at: null,
      requires_acknowledgement: false,
      audience_scope: "all",
      audience_role_ids: [],
    });
  });

  it("keeps audience targeting separate from the optional acknowledgement prompt", async () => {
    const user = userEvent.setup();
    renderSection();

    await screen.findByDisplayValue("A draft notice");
    await user.click(screen.getByRole("radio", { name: /importantNotices\.audience\.roles/ }));

    expect(screen.queryByText("importantNotices.audience.roleLevel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "importantNotices.action.save" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Officer" }));
    await user.click(screen.getByRole("switch", { name: "importantNotices.field.forceAcknowledgement" }));
    await user.click(screen.getByRole("button", { name: "importantNotices.action.save" }));

    await waitFor(() => expect(mocks.updateAdminImportantNotice).toHaveBeenCalledTimes(1));
    expect(mocks.updateAdminImportantNotice).toHaveBeenCalledWith("notice-1", expect.objectContaining({
      audience_scope: "roles",
      audience_role_ids: ["role-officer"],
      requires_acknowledgement: true,
    }));
  });

  it("allows an administrator to withdraw a scheduled notice", async () => {
    mocks.fetchAdminImportantNotices.mockResolvedValue([{
      ...notice,
      status: "scheduled",
      publish_at: "2026-09-01T00:00:00.000Z",
      publication_revision: 1,
    }]);
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByText("A draft notice"));

    expect(screen.getByRole("button", { name: "importantNotices.action.withdraw" })).toBeEnabled();
  });

  it("names the editable notice body for assistive technology", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByText("A draft notice"));

    expect(screen.getByRole("textbox", { name: "importantNotices.field.body" })).toBeInTheDocument();
  });

  it("keeps the schedule controls beside the title and body editor", async () => {
    renderSection();

    await screen.findByText("A draft notice");

    const editorGrid = document.querySelector(".important-notices-admin__editor-grid");
    const editorMain = document.querySelector(".important-notices-admin__editor-main");
    const schedule = document.querySelector(".important-notices-admin__schedule");

    if (!(editorGrid instanceof HTMLElement)
      || !(editorMain instanceof HTMLElement)
      || !(schedule instanceof HTMLElement)) {
      throw new Error("Expected the notice editor layout to be rendered");
    }

    expect(editorGrid).toContainElement(editorMain);
    expect(editorGrid).toContainElement(schedule);
    expect(editorMain).toContainElement(screen.getByRole("textbox", { name: "importantNotices.field.title" }));
    expect(editorMain).toContainElement(screen.getByRole("textbox", { name: "importantNotices.field.body" }));
    expect(schedule).toContainElement(screen.getByLabelText("importantNotices.field.publishAt"));
    expect(schedule).toContainElement(screen.getByLabelText("importantNotices.field.expiresAt"));
  });

  it("uses one full-workspace empty state until the administrator starts creating a notice", async () => {
    mocks.fetchAdminImportantNotices.mockResolvedValue([]);
    const user = userEvent.setup();
    renderSection();

    await screen.findByText("importantNotices.empty.title");
    expect(screen.queryByText("importantNotices.selectHint")).not.toBeInTheDocument();
    expect(document.querySelector(".important-notices-admin--empty")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "importantNotices.action.create" }));

    expect(screen.getByRole("textbox", { name: "importantNotices.field.title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "importantNotices.action.save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "importantNotices.action.publish" })).toBeDisabled();
    expect(screen.getByText("importantNotices.unsavedBeforePublish")).toBeInTheDocument();
  });
});

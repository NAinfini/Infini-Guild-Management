import type { ImportantNotice } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminImportantNoticesSection, draftFromNotice } from "./AdminImportantNoticesSection";

const mocks = vi.hoisted(() => ({
  fetchAdminImportantNotices: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@portal/api/queries/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@portal/api/queries/notifications")>()),
  fetchAdminImportantNotices: mocks.fetchAdminImportantNotices,
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
}

describe("AdminImportantNoticesSection", () => {
  beforeEach(() => {
    mocks.fetchAdminImportantNotices.mockReset().mockResolvedValue([notice]);
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
      throw new Error("Expected the important notice editor layout to be rendered");
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
  });
});

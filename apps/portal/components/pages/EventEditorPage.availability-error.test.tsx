import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventEditorPage } from "./EventEditorPage";

const mocks = vi.hoisted(() => ({
  retry: vi.fn(async () => undefined),
  useMemberAvailabilitySummary: vi.fn(),
  resetAttachmentItems: vi.fn(),
  openCreateEditor: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearch: () => ({}),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock("../../hooks/data/useMemberDirectory", () => ({
  useMemberAvailabilitySummary: mocks.useMemberAvailabilitySummary,
}));
vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: "admin-1" } }),
}));
vi.mock("../../hooks/useAppError", () => ({ useAppError: () => ({ showError: vi.fn() }) }));
vi.mock("../../services/AttachmentService", () => ({
  useAttachmentService: () => ({ releaseItems: vi.fn() }),
}));
vi.mock("../../services/EventService", () => ({
  EventService: class {},
  fetchEventDetail: vi.fn(),
  isApiRequestError: () => false,
}));
vi.mock("../../hooks/useEventMutations", () => ({
  useEventEditorMutations: () => ({
    resetAttachmentItems: mocks.resetAttachmentItems,
    handleFilesSelected: vi.fn(),
    handleAttachmentDelete: vi.fn(),
    saveEvent: vi.fn(),
    savePending: false,
  }),
}));
vi.mock("../feature/events/useEventsEditorController", () => ({
  useEventsEditorController: () => ({
    editorOpen: true,
    editorMode: "create",
    editorType: "social",
    editingEventId: null,
    editingExpectedUpdatedAt: null,
    editorTitle: "",
    editorDescription: "",
    editorStartAt: "",
    editorStartIso: null,
    editorEndAt: "",
    editorEndIso: null,
    editorCapacity: null,
    editorPinned: false,
    editorSignupLocked: false,
    editorAutoArchive: false,
    editorPollOptions: [],
    editorPollResultsVisibility: "after_end",
    editorPollShowVoterNames: false,
    editorWinnerCount: null,
    editorClassQuotas: [],
    closeEditorAfterSave: vi.fn(),
    markEditorTouched: vi.fn(),
    openCreateEditor: mocks.openCreateEditor,
    openEditEditor: vi.fn(),
    setEditorTitle: vi.fn(),
    setEditorDescription: vi.fn(),
    setEditorType: vi.fn(),
    setEditorStartAt: vi.fn(),
    setEditorEndAt: vi.fn(),
    setEditorCapacity: vi.fn(),
    setEditorAutoArchive: vi.fn(),
    setEditorPollOptions: vi.fn(),
    setEditorPollResultsVisibility: vi.fn(),
    setEditorPollShowVoterNames: vi.fn(),
    setEditorWinnerCount: vi.fn(),
    setEditorClassQuotas: vi.fn(),
  }),
}));
vi.mock("../feature/events/EventFormContent", () => ({
  EventFormContent: () => <div data-testid="event-form" />,
}));

describe("EventEditorPage availability errors", () => {
  it("shows a retry action when the authenticated availability summary fails", async () => {
    mocks.useMemberAvailabilitySummary.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      refetch: mocks.retry,
    });

    render(<EventEditorPage mode="create" />);

    expect(mocks.useMemberAvailabilitySummary).toHaveBeenCalledWith({
      currentUserId: "admin-1",
      enabled: true,
    });
    expect(screen.getByText("loadError")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "action.retry" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});

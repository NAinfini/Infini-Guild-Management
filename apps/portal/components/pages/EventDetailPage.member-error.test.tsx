import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventDetailPage } from "./EventDetailPage";

const mocks = vi.hoisted(() => ({
  retry: vi.fn(async () => undefined),
  contentProps: null as null | Record<string, unknown>,
}));

const event = {
  id: "event-1",
  title: "Mission",
  type: "social",
  start_at: "2099-01-01T00:00:00.000Z",
  end_at: null,
  capacity: 1,
  participants: [{
    id: "participant-1",
    event_id: "event-1",
    user_id: "member-1",
    joined_at: "2098-12-01T00:00:00.000Z",
  }],
  poll: null,
  raffle_winners: [],
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: event, isLoading: false, isError: false }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "event-1" }),
}));

vi.mock("../../hooks/data/useMemberDirectory", () => ({
  useMemberDirectory: () => ({
    entries: [],
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    selectedQuery: { isError: true },
    loadError: { kind: "identities", retry: mocks.retry, retrying: false },
  }),
}));

vi.mock("../../hooks/useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({ canManage: () => true }),
}));
vi.mock("../../hooks/useExternalView", () => ({ useExternalView: () => false }));
vi.mock("../../hooks/useAppError", () => ({ useAppError: () => ({ showError: vi.fn() }) }));
vi.mock("../../hooks/useConfirmDialog", () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: "admin-1" } }),
}));
vi.mock("../../hooks/useEventMutations", () => ({
  useEventActions: () => ({
    participantPendingEventIds: new Set(),
    handleJoin: vi.fn(),
    handleLeave: vi.fn(),
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    votePoll: vi.fn(),
    votePending: false,
    drawRaffle: vi.fn(),
    drawRafflePending: false,
    unarchiveEvent: vi.fn(),
    archiveEventById: vi.fn(),
    deleteEventWithConfirm: vi.fn(),
  }),
}));
vi.mock("../../services/EventService", () => ({
  fetchEventDetail: vi.fn(),
  isApiRequestError: () => false,
}));
vi.mock("../feature/events/EventDetailContent", () => ({
  EventDetailContent: (props: Record<string, unknown>) => {
    mocks.contentProps = props;
    return <div data-testid="event-content" />;
  },
}));

describe("EventDetailPage member identity errors", () => {
  it("offers identity retry and does not turn unresolved participants into an empty roster", async () => {
    render(<EventDetailPage />);

    expect(screen.getByText("loadError")).toBeInTheDocument();
    expect(mocks.contentProps?.memberIdentitiesUnavailable).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "action.retry" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});

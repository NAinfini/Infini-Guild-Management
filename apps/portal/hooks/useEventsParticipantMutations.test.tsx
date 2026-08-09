// @vitest-environment jsdom
import type { User } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEventsParticipantMutations } from "./useEventsParticipantMutations";

const joinEvent = vi.hoisted(() => vi.fn());
vi.mock("../services/EventService", () => ({
  joinEvent,
  leaveEvent: vi.fn(),
  addEventParticipants: vi.fn(),
  removeEventParticipants: vi.fn(),
}));
vi.mock("@portal/hooks/useConfirmDialog", () => ({ useConfirmDialog: () => vi.fn().mockResolvedValue(true) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../utils/notifications", () => ({ notifySuccess: vi.fn() }));

describe("useEventsParticipantMutations", () => {
  it("serializes rapid participant actions for the same event and keeps pending through settle", async () => {
    let resolve!: (value: unknown) => void;
    joinEvent.mockReturnValue(new Promise((res) => { resolve = res; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useEventsParticipantMutations({
      canInteract: true,
      user: { id: "user-1", permissions: {} } as User,
      eventById: new Map(),
      joinedEventRanges: [],
      showError: vi.fn(),
    }), { wrapper });

    act(() => {
      void result.current.handleJoin("event-1");
      void result.current.handleJoin("event-1");
    });

    await waitFor(() => expect(joinEvent).toHaveBeenCalledTimes(1));
    expect(result.current.participantPendingEventIds.has("event-1")).toBe(true);
    resolve({ ok: true });
    await waitFor(() => expect(result.current.participantPendingEventIds.has("event-1")).toBe(false));
  });
});

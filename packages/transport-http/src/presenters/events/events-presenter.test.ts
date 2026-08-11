import { describe, expect, it } from "vitest";
import type { EventViewerAggregate } from "@guild/server/modules/events";
import { eventDetailSchema } from "@guild/shared";
import { presentEvent, presentEventList } from "./events-presenter.js";

const NOW = "2026-08-09T12:00:00.000Z";

const poll: EventViewerAggregate = {
  event: {
    id: "event-1", type: "poll", title: "Vote", description: null,
    startAt: NOW, endAt: "2026-08-10T12:00:00.000Z", capacity: null,
    pinned: false, signupLocked: false, autoArchive: false, autoArchived: false,
    visibleAt: null, archivedAt: null, createdBy: "admin-1", updatedBy: null,
    seriesId: null, instanceDate: null, winnerCount: null, createdAt: NOW, updatedAt: NOW,
  },
  attachments: [], classQuotas: [], raffleWinners: [],
  participants: [{ id: "participant-1", event_id: "event-1", user_id: "user-1", joined_at: NOW }],
  poll: {
    resultsVisibility: "after_vote",
    showVoterNames: false,
    viewerHasVoted: true,
    viewerCanVote: true,
    options: [
      {
        id: "option-1", label: "A", sortOrder: 0, voteCount: 2,
        visibleVoterIds: [], votedByViewer: true,
      },
      {
        id: "option-2", label: "B", sortOrder: 1, voteCount: 0,
        visibleVoterIds: [], votedByViewer: false,
      },
    ],
  },
};

describe("events Portal presenter", () => {
  it("maps the pre-redacted viewer projection through the shared schema", () => {
    const value = eventDetailSchema.parse(presentEvent(poll, true));
    expect(value.poll).toMatchObject({ has_voted: true, can_vote: true });
    expect(value.poll?.options[0]).toMatchObject({
      vote_count: 2,
      voter_ids: [],
      voted_by_me: true,
    });
  });

  it("validates the complete paginated response at the presenter boundary", () => {
    expect(presentEventList({ data: [poll], total: 1, page: 1, limit: 20, totalPages: 1 }))
      .toMatchObject({ total: 1, page: 1, limit: 20, total_pages: 1 });
    expect(() => presentEventList({ data: [], total: 0, page: 1, limit: 101, totalPages: 0 })).toThrow();
  });
});

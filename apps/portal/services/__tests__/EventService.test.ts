import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";
import {
  addEventParticipants,
  EventService,
  EventValidationError,
  removeEventParticipants,
} from "../EventService";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("EventService", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sends participant additions as one batch request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: [] }));
    await addEventParticipants("evt-1", ["u-1", "u-2"]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/events/evt-1/participants");
    expect(url).not.toContain("/batch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ user_ids: ["u-1", "u-2"] });
  });

  it("sends participant removals as one request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, removed: 2 }));
    await removeEventParticipants("evt-1", ["u-1", "u-2"]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/events/evt-1/participants");
    expect(url).not.toContain("/batch");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ user_ids: ["u-1", "u-2"] });
  });

  it("creates events with trimmed payloads and extracted files", async () => {
    const file = new File(["image"], "poster.png", { type: "image/png" });
    const attachmentService = {
      extractNewFiles: vi.fn(() => [file]),
      extractExistingUrls: vi.fn(() => []),
    };
    const createEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const service = new EventService({
      attachmentService,
      queryClient: { invalidateQueries } as unknown as QueryClient,
      createEvent,
      updateEvent: vi.fn(),
      uploadEventImages: vi.fn(),
    });

    await service.saveEvent({
      mode: "create",
      editingEventId: null,
      eventType: "social",
      title: "  Guild Run  ",
      description: "  Bring food  ",
      startAt: "2026-03-20T19:00",
      startIso: "2026-03-20T19:00:00.000Z",
      endAt: "",
      endIso: null,
      capacity: "25",
      pinned: false,
      signupLocked: false,
      autoArchive: true,
      attachmentItems: [{ id: "blob-1", src: "blob:poster", file }],
    });

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "social",
        title: "Guild Run",
        description: "Bring food",
        start_at: "2026-03-20T19:00:00.000Z",
        end_at: undefined,
        capacity: 25,
        attachments: [],
        auto_archive: true,
      }),
      [file],
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.events.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard.all });
  });

  it("updates events by uploading new files and merging existing attachment keys", async () => {
    const newFile = new File(["image"], "new.png", { type: "image/png" });
    const attachmentService = {
      extractNewFiles: vi.fn(() => [newFile]),
      extractExistingUrls: vi.fn(() => ["events/existing.png"]),
    };
    const updateEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const uploadEventImages = vi.fn().mockResolvedValue({
      keys: ["events/new.png"],
      attachments: ["events/existing.png", "events/new.png"],
    });
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const service = new EventService({
      attachmentService,
      queryClient: { invalidateQueries } as unknown as QueryClient,
      createEvent: vi.fn(),
      updateEvent,
      uploadEventImages,
    });

    await service.saveEvent({
      mode: "edit",
      editingEventId: "evt-1",
      eventType: "social",
      title: "War Review",
      description: "",
      startAt: "2026-03-21T20:00",
      startIso: "2026-03-21T20:00:00.000Z",
      endAt: "",
      endIso: null,
      capacity: "",
      pinned: true,
      signupLocked: true,
      autoArchive: false,
      attachmentItems: [
        { id: "existing", src: "events/existing.png" },
        { id: "new", src: "blob:new", file: newFile },
      ],
    });

    expect(uploadEventImages).toHaveBeenCalledWith("evt-1", [newFile]);
    expect(updateEvent).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({
        title: "War Review",
        pinned: true,
        signup_locked: true,
        auto_archive: false,
        attachments: ["events/existing.png", "events/new.png"],
      }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.events.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard.all });
  });

  it("rejects invalid drafts before any network call", async () => {
    const createEvent = vi.fn();
    const service = new EventService({
      attachmentService: {
        extractNewFiles: vi.fn(() => []),
        extractExistingUrls: vi.fn(() => []),
      },
      createEvent,
      updateEvent: vi.fn(),
      uploadEventImages: vi.fn(),
    });

    await expect(
      service.saveEvent({
        mode: "create",
        editingEventId: null,
        eventType: "social",
        title: " ",
        description: "",
        startAt: "",
        startIso: null,
        endAt: "",
        endIso: null,
        capacity: "0",
        pinned: false,
        signupLocked: false,
        autoArchive: false,
        attachmentItems: [],
      }),
    ).rejects.toMatchObject({
      name: EventValidationError.name,
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("creates poll events with required end time and poll options", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const service = new EventService({
      attachmentService: {
        extractNewFiles: vi.fn(() => []),
        extractExistingUrls: vi.fn(() => []),
      },
      createEvent,
      updateEvent: vi.fn(),
      uploadEventImages: vi.fn(),
    });

    await service.saveEvent({
      mode: "create",
      editingEventId: null,
      eventType: "poll",
      title: "Next activity?",
      description: "",
      startAt: "2026-03-20T19:00",
      startIso: "2026-03-20T19:00:00.000Z",
      endAt: "2026-03-20T21:00",
      endIso: "2026-03-20T21:00:00.000Z",
      capacity: "",
      pinned: false,
      signupLocked: false,
      autoArchive: true,
      pollOptions: ["Raid", "Dungeon"],
      pollResultsVisibility: "after_vote",
      pollShowVoterNames: false,
      attachmentItems: [],
    });

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "poll",
        end_at: "2026-03-20T21:00:00.000Z",
        capacity: undefined,
        poll: {
          options: ["Raid", "Dungeon"],
          results_visibility: "after_vote",
          show_voter_names: false,
        },
      }),
      [],
    );
  });
});

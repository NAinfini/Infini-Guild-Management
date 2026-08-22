import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { AuditEvent } from "@guild/shared";
import { AuditService, createAuditEvent, type AuditStore } from "./audit";

function context(permissions: readonly string[] = []) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: new Set(permissions),
    }),
    now: "2026-08-09T00:00:00.000Z",
  });
}

describe("audit boundary", () => {
  it("captures the verified actor and a bounded JSON detail object", () => {
    const event = createAuditEvent(context(), {
      subjectType: "announcement",
      subjectId: " announcement-1 ",
      subjectLabel: "Launch",
      action: "create",
      changes: [{
        field: "title",
        before: { type: "null", value: null },
        after: { type: "text", value: "Launch" },
      }],
    });

    expect(event).toMatchObject({
      requestId: "request-1",
      actorKind: "user",
      actorId: "user-1",
      subjectId: "announcement-1",
      subjectLabel: "Launch",
      occurredAt: "2026-08-09T00:00:00.000Z",
      payload: {
        schema_version: 2,
        changes: [{
          field: "title",
          before: { type: "null", value: null },
          after: { type: "text", value: "Launch" },
        }],
        context: [],
      },
    });
  });

  it("rejects opaque structured codes and unlabeled business references", () => {
    expect(() => createAuditEvent(context(), {
      subjectType: "analytics_settings",
      subjectId: "analytics",
      action: "update",
      context: [{ field: "analytics_settings", value: { type: "code", value: '{"kills":1}' } }],
    })).toThrow(/serialized data/i);

    expect(() => createAuditEvent(context(), {
      subjectType: "event_participant",
      subjectId: "event-1",
      action: "batch_add_by_moderator",
      context: [{
        field: "user_ids",
        value: { type: "list", value: [{ type: "reference", value: { id: "user-1", label: null } }] },
      }],
    })).toThrow(/display label/i);

    expect(() => createAuditEvent(context(), {
      subjectType: "system_test",
      subjectId: "run-1",
      action: "run",
      context: [{ field: "errors", value: { type: "text", value: "request body" } }],
    })).toThrow(/cannot be written by runtime business operations/i);

    expect(() => createAuditEvent(context(), {
      subjectType: "announcement",
      subjectId: "announcement-1",
      action: "update",
      context: [{ field: "body", value: { type: "text", value: "Full announcement body" } }],
    })).toThrow(/cannot be written by runtime business operations/i);

    expect(() => createAuditEvent(context(), {
      subjectType: "announcement",
      subjectId: "announcement-1",
      action: "update",
      context: [{ field: "changed_sections", value: {
        type: "list",
        value: [{ type: "code", value: "body" }],
      } }],
    })).toThrow(/no controlled display value/i);
  });

  it("allows technical filter references while rejecting ambiguous duplicate fields", () => {
    expect(() => createAuditEvent(context(), {
      subjectType: "audit_log_export",
      subjectId: "request-1",
      action: "export_filtered_json",
      context: [{ field: "subject_id", value: { type: "reference", value: { id: "event-1", label: null } } }],
    })).not.toThrow();

    expect(() => createAuditEvent(context(), {
      subjectType: "event",
      subjectId: "event-1",
      action: "update",
      context: [
        { field: "status", value: { type: "code", value: "active" } },
        { field: "status", value: { type: "code", value: "archived" } },
      ],
    })).toThrow(/duplicate fields/i);
  });

  it("requires localized controlled values while preserving exact business slugs", () => {
    expect(() => createAuditEvent(context(), {
      subjectType: "announcement",
      subjectId: "announcement-1",
      action: "create",
      context: [{ field: "status", value: { type: "code", value: "mystery-state" } }],
    })).toThrow(/no controlled display value/i);

    expect(() => createAuditEvent(context(), {
      subjectType: "wiki_category",
      subjectId: "category-1",
      action: "create",
      context: [{ field: "slug", value: { type: "code", value: "raid-strategy" } }],
    })).not.toThrow();
  });

  it("does not let audit read and export permissions substitute for each other", async () => {
    const store: AuditStore = {
      list: vi.fn().mockResolvedValue({ data: [], hasMore: false }),
      export: vi.fn(),
      recordExport: vi.fn(),
    };
    const service = new AuditService(store);

    await service.list(context(["admin.audit.view"]), { limit: 25 });
    expect(() => service.export(context(["admin.audit.view"]), {})).toThrowError(/permission/i);
  });

  it("uses an opaque stable cursor and preserves the exact entity timeline filter", async () => {
    const first: AuditEvent = {
      event_id: "audit-c",
      request_id: "request-c",
      actor: { kind: "user", id: "user-1", label: "member" },
      subject: { type: "event", id: "event-1", label: "Updated event" },
      action: "update",
      payload: { schema_version: 2, changes: [], context: [] },
      occurred_at: "2026-08-08T12:00:00.000Z",
    };
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [first], hasMore: true })
      .mockResolvedValueOnce({ data: [], hasMore: false });
    const service = new AuditService({ list, export: vi.fn(), recordExport: vi.fn() });

    const page = await service.list(context(["admin.audit.view"]), {
      limit: 1,
      subjectType: "event",
      subjectId: "event-1",
    });
    expect(page.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);

    await service.list(context(["admin.audit.view"]), {
      limit: 1,
      cursor: page.next_cursor!,
      subjectType: "event",
      subjectId: "event-1",
    });
    expect(list.mock.calls[1]?.[0]).toMatchObject({
      subjectType: "event",
      subjectId: "event-1",
      cursor: { occurredAt: first.occurred_at, eventId: first.event_id },
    });
  });

  it("rejects forged cursors and unindexed entity-id-only queries", async () => {
    const service = new AuditService({ list: vi.fn(), export: vi.fn(), recordExport: vi.fn() });
    await expect(service.list(context(["admin.audit.view"]), { limit: 25, cursor: "%%%" }))
      .rejects.toThrow(/cursor/i);
    await expect(service.list(context(["admin.audit.view"]), { limit: 25, subjectId: "event-1" }))
      .rejects.toThrow(/subject type/i);
  });

  it("records the export actor, format, and normalized filters before streaming", async () => {
    const recordExport = vi.fn().mockResolvedValue(undefined);
    const store: AuditStore = {
      list: vi.fn(),
      export: vi.fn(),
      recordExport,
    };
    const service = new AuditService(store);
    const query = {
      subjectType: "event" as const,
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-08-09T00:00:00.000Z",
    };

    await service.recordExport(context(["admin.audit.export"]), "csv", query);

    expect(recordExport).toHaveBeenCalledOnce();
    expect(recordExport.mock.calls[0]?.[0]).toMatchObject({
      requestId: "request-1",
      actorId: "user-1",
      subjectType: "audit_log_export",
      subjectId: "request-1",
      action: "export_filtered_csv",
      payload: {
        schema_version: 2,
        changes: [],
        context: [
          { field: "format", value: { type: "code", value: "csv" } },
          { field: "subject_type", value: { type: "code", value: "event" } },
          { field: "start_at", value: { type: "datetime", value: "2026-08-01T00:00:00.000Z" } },
          { field: "end_at", value: { type: "datetime", value: "2026-08-09T00:00:00.000Z" } },
        ],
      },
    });
  });
});

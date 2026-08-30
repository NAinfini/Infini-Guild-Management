import type { AdminRole, AuditEvent } from "@guild/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuditLogViewer } from "./AuditLogViewer";

const translations: Record<string, string> = {
  "audit.action.create": "Created",
  "audit.action.init": "Initialized",
  "audit.action.reorder": "Reordered",
  "audit.action.run": "Ran",
  "audit.action.update": "Updated",
  "audit.actor.system": "System",
  "audit.actor.unknown": "Unknown operator",
  "audit.code.local": "Local environment",
  "audit.code.active": "Active",
  "audit.code.weekly": "Every week",
  "audit.detail.after": "After",
  "audit.detail.before": "Before",
  "audit.detail.changes": "Changes",
  "audit.detail.context": "Details",
  "audit.detail.environment": "Environment",
  "audit.detail.grantedRole": "Granted role",
  "audit.detail.notRecorded": "Not recorded",
  "audit.detail.region": "{{event}} event details",
  "audit.detail.showFull": "Show full",
  "audit.detail.showLess": "Show less",
  "audit.detail.truncated": "… (truncated)",
  "audit.entityType.invite_link": "Invite link",
  "audit.entityType.member_badge": "Member badge",
  "audit.entityType.seed": "System",
  "audit.entityType.site_config": "Site configuration",
  "audit.entityType.system_test": "System test",
  "audit.field.active": "Active",
  "audit.field.archived_at": "Archived on",
  "audit.field.capacity": "Capacity",
  "audit.field.changed_sections": "Changed sections",
  "audit.field.expires_at": "Expires",
  "audit.field.errors": "Errors",
  "audit.field.max_uses": "Maximum uses",
  "audit.field.notes": "Notes",
  "audit.field.order": "Order",
  "audit.field.passed": "Passed",
  "audit.field.permissions": "Permissions",
  "audit.field.publish_at": "Published on",
  "audit.field.recurrence_frequency": "Recurrence",
  "audit.field.role_id": "Role",
  "audit.field.status": "Status",
  "audit.field.title": "Title",
  "audit.field.total": "Total",
  "audit.field.type": "Environment",
  "audit.field.user_ids": "Members",
  "audit.field.used_count": "Uses so far",
  "audit.section.body_json": "Article content",
  "audit.loadMore": "Load more",
  "audit.noResults": "No audit events",
  "audit.relativeTime.daysAgo": "{{count}}d ago",
  "audit.relativeTime.hoursAgo": "{{count}}h ago",
  "audit.relativeTime.justNow": "just now",
  "audit.relativeTime.minutesAgo": "{{count}}m ago",
  "audit.sentence.invite_link.create": "<actor>{{actor}}</actor> created an invite link for <subject>{{subject}}</subject>.",
  "audit.sentence.invite_link.create.noSubject": "<actor>{{actor}}</actor> created an invite link.",
  "audit.sentence.reorder.noSubject": "<actor>{{actor}}</actor> reordered the {{entity}} list.",
  "audit.sentence.seed.init.noSubject": "<actor>{{actor}}</actor> initialized the development data.",
  "audit.sentence.system_test.run": "<actor>{{actor}}</actor> completed the full system test: {{passed}}/{{total}} passed.",
  "audit.sentence.site_config.update": "<actor>{{actor}}</actor> edited the site settings of <subject>{{subject}}</subject>.",
  "audit.sentence.update": "<actor>{{actor}}</actor> edited the {{entity}} <subject>{{subject}}</subject>.",
  "audit.sentence.update.noSubject": "<actor>{{actor}}</actor> edited a {{entity}}.",
  "audit.technical.actorId": "Actor ID",
  "audit.technical.change": "{{before}} to {{after}}",
  "audit.technical.copied": "Copied {{field}}",
  "audit.technical.copy": "Copy {{field}}",
  "audit.technical.description": "Request identifiers and system fields used to diagnose problems.",
  "audit.technical.eventId": "Event ID",
  "audit.technical.requestId": "Request ID",
  "audit.technical.subjectId": "Subject ID",
  "audit.technical.title": "Troubleshooting",
  "audit.timeline.view": "View activity for “{{entity}}”",
  "audit.value.boolean.false": "No",
  "audit.value.boolean.true": "Yes",
  "audit.value.empty": "Empty",
  "audit.value.list.empty": "None",
  "audit.value.list.more": "{{count}} more",
  "audit.value.null.default": "Not set",
  "audit.value.null.never": "Never expires",
  "audit.value.reference.unknown": "Unknown reference",
  "audit.value.reference.unknownRole": "Unknown role",
  "audit.value.reference.unknownUser": "Unknown member",
  "audit.value.technicalIdentifier": "Technical identifier hidden",
  "audit.value.structuredDetailsUnavailable": "Detailed values are unavailable for this record",
  "roles.permission.admin.audit.view": "View audit logs",
};

function interpolate(template: string, options?: Record<string, unknown>): string {
  return template.replace(/{{\s*([^{}\s]+)\s*}}/g, (_, key: string) => String(options?.[key] ?? ""));
}

vi.mock("react-i18next", () => ({
  Trans: ({ i18nKey, values }: { i18nKey: string | string[]; values?: Record<string, unknown> }) => {
    const keys = Array.isArray(i18nKey) ? i18nKey : [i18nKey];
    const resolved = keys.find((key) => key in translations) ?? keys.at(-1) ?? "";
    return interpolate(translations[resolved] ?? resolved, values).replace(/<\/?(?:actor|subject)>/g, "");
  },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: Record<string, unknown>) => interpolate(translations[key] ?? key, options),
  }),
}));

const ROLE: AdminRole = {
  id: "raid-lead",
  name: "Raid Lead",
  level: 200,
  color: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  revision_token: "raid-lead-v1",
  permissions: {} as AdminRole["permissions"],
  assigned_user_count: 2,
};

function makeAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    event_id: "event-01",
    request_id: "request-01",
    actor: { kind: "user", id: "admin-user-id", label: "GuildAdmin" },
    subject: { type: "site_config", id: "site-config", label: "Guild settings" },
    action: "update",
    payload: { schema_version: 2, changes: [], context: [] },
    occurred_at: "2026-08-14T12:00:00.000-04:00",
    ...overrides,
  };
}

function renderViewer(
  auditRows: AuditEvent[],
  overrides: Partial<ComponentProps<typeof AuditLogViewer>> = {},
) {
  const props: ComponentProps<typeof AuditLogViewer> = {
    auditLoading: false,
    auditError: false,
    onRetryAudit: vi.fn(),
    auditRows,
    auditHasMore: false,
    auditLoadingMore: false,
    onAuditLoadMore: vi.fn(),
    onSelectEntityTimeline: vi.fn(),
    rolesData: [ROLE],
    userMap: new Map([
      ["user-a", "Alice"],
      ["user-b", "Bob"],
    ]),
    ...overrides,
  };
  render(<AuditLogViewer {...props} />);
  return props;
}

describe("AuditLogViewer", () => {
  it("presents an invite as natural language and keeps every identifier in the folded technical area", async () => {
    const user = userEvent.setup();
    const eventId = "4aeb6550-3f88-4bca-9bf0-0f57d1c357ba";
    const requestId = "7dc334eb-67df-4a92-8461-1ebef4ec94f8";
    const actorId = "a4f35cbc-3b6b-48ff-b56f-1400dd77bec8";
    const subjectId = "fcd3254e-6e59-46b9-bf99-6d9fb4e10660";
    renderViewer([makeAuditEvent({
      event_id: eventId,
      request_id: requestId,
      actor: { kind: "user", id: actorId, label: "GuildAdmin" },
      subject: { type: "invite_link", id: subjectId, label: null },
      action: "create",
      payload: {
        schema_version: 2,
        changes: [],
        context: [
          { field: "role_id", value: { type: "reference", value: { id: ROLE.id, label: null } } },
          { field: "max_uses", value: { type: "number", value: 20 } },
          { field: "used_count", value: { type: "number", value: 3 } },
          { field: "status", value: { type: "code", value: "active" } },
          { field: "expires_at", value: { type: "null", value: null } },
        ],
      },
    })]);

    const rowButton = screen.getByRole("button", { name: /GuildAdmin created an invite link/i });
    expect(rowButton).toHaveTextContent("GuildAdmin created an invite link for Raid Lead.");
    expect(rowButton).toHaveAttribute("aria-expanded", "false");
    expect(rowButton).toHaveAttribute("aria-controls", "audit-event-details-0");
    expect(within(rowButton).queryByText("20")).not.toBeInTheDocument();
    expect(within(rowButton).queryByText("Never expires")).not.toBeInTheDocument();
    expect(within(rowButton).getByText(/Invite link/)).toBeVisible();
    expect(within(rowButton).getByText(/Created/)).toBeVisible();
    const time = rowButton.querySelector("time");
    expect(time).toBeInstanceOf(HTMLTimeElement);
    expect(time).toHaveAttribute("datetime", "2026-08-14T12:00:00.000-04:00");
    expect(time).toHaveTextContent(/just now|ago|2026/);
    for (const identifier of [eventId, requestId, actorId, subjectId]) {
      expect(screen.queryByText(identifier)).not.toBeInTheDocument();
    }

    await user.click(rowButton);
    expect(rowButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Granted role")).toBeVisible();
    expect(screen.getByText("Raid Lead")).toBeVisible();
    expect(screen.getByText("Maximum uses")).toBeVisible();
    expect(screen.getByText("20")).toBeVisible();
    expect(screen.getByText("Uses so far")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("Status")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Expires")).toBeVisible();
    expect(screen.getByText("Never expires")).toBeVisible();
    expect(screen.getByText(subjectId)).not.toBeVisible();

    await user.click(screen.getByText("Troubleshooting"));
    expect(screen.getByText(subjectId)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Copy Subject ID" }));
    expect(await navigator.clipboard.readText()).toBe(subjectId);
  });

  it("never treats a stored invite sentence as the granted role", async () => {
    const user = userEvent.setup();
    renderViewer([makeAuditEvent({
      subject: {
        type: "invite_link",
        id: "dev-invite-active",
        label: "Created an active development invite",
      },
      action: "create",
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "max_uses", value: { type: "number", value: 10 } }],
      },
    })]);

    const rowButton = screen.getByRole("button", { name: /^GuildAdmin created an invite link\./ });
    expect(rowButton).not.toHaveTextContent("Created an active development invite");
    await user.click(rowButton);
    expect(screen.getByText("Granted role")).toBeVisible();
    expect(screen.getByText("Expires")).toBeVisible();
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText("Maximum uses")).toBeVisible();
    expect(screen.getByText("10")).toBeVisible();
  });

  it("renders changes and every AuditValue kind as localized business data", async () => {
    const user = userEvent.setup();
    renderViewer([makeAuditEvent({
      payload: {
        schema_version: 2,
        changes: [
          { field: "title", before: { type: "text", value: "Old title" }, after: { type: "text", value: "New title" } },
          { field: "capacity", before: { type: "number", value: 5 }, after: { type: "number", value: 20 } },
        ],
        context: [
          { field: "active", value: { type: "boolean", value: true } },
          { field: "archived_at", value: { type: "date", value: "2026-01-15" } },
          { field: "publish_at", value: { type: "datetime", value: "2026-01-15T10:30:00.000-05:00" } },
          { field: "recurrence_frequency", value: { type: "code", value: "weekly" } },
          { field: "role_id", value: { type: "reference", value: { id: ROLE.id, label: null } } },
          { field: "user_ids", value: { type: "list", value: [
            { type: "reference", value: { id: "user-a", label: null } },
            { type: "reference", value: { id: "user-b", label: null } },
          ] } },
          { field: "expires_at", value: { type: "null", value: null } },
          { field: "status", value: { type: "code", value: "future_status_code" } },
          { field: "changed_sections", value: { type: "list", value: [
            { type: "code", value: "body_json" },
            { type: "code", value: "title" },
          ] } },
          { field: "permissions", value: { type: "list", value: [
            { type: "code", value: "admin.audit.view" },
          ] } },
        ],
      },
    })]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin edited the site settings of Guild settings.*Updated/i }));
    expect(screen.getByRole("heading", { name: "Changes" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Details" })).toBeVisible();
    for (const text of ["Old title", "New title", "5", "20", "Yes", "Every week", "Raid Lead", "Never expires", "Future status code", "View audit logs"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(document.body).toHaveTextContent("Article content");
    expect(document.body).toHaveTextContent(/Alice.*Bob/);
    expect(document.body).toHaveTextContent(/Jan.*15.*2026/);
    expect(document.body).not.toHaveTextContent("audit.code.future_status_code");
  });

  it("shows a reordered sequence whole, in order, and without a conjunction", async () => {
    const user = userEvent.setup();
    const badges = ["Ember", "Frost", "Gale", "Halo", "Iris", "Jade"];
    const sequence = (labels: readonly string[]) => ({
      type: "list" as const,
      value: labels.map((label) => ({
        type: "reference" as const,
        value: { id: `badge-${label.toLowerCase()}`, label },
      })),
    });
    renderViewer([makeAuditEvent({
      subject: { type: "member_badge", id: "catalog", label: null },
      action: "reorder",
      payload: {
        schema_version: 2,
        changes: [{ field: "order", before: sequence(badges), after: sequence([...badges].reverse()) }],
        context: [],
      },
    })]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin reordered the Member badge list/ }));
    expect(document.body).toHaveTextContent("Ember, Frost, Gale, Halo, Iris, Jade");
    expect(document.body).toHaveTextContent("Jade, Iris, Halo, Gale, Frost, Ember");
    expect(document.body).not.toHaveTextContent("more");
  });

  it("keeps operation details flat and reserves disclosure for troubleshooting", async () => {
    const user = userEvent.setup();
    renderViewer([makeAuditEvent({
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "active", value: { type: "boolean", value: true } }],
      },
    })]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin.*Guild settings/ }));
    const contextHeading = screen.getByRole("heading", { name: "Details" });
    const technicalHeading = screen.getByRole("heading", { name: "Troubleshooting" });
    const contextSummary = contextHeading.closest("summary");
    const technicalSummary = technicalHeading.closest("summary");
    const technicalDisclosure = technicalSummary?.closest("details");

    expect(contextSummary).toBeNull();
    expect(technicalSummary).not.toBeNull();
    expect(technicalDisclosure).not.toHaveAttribute("open");

    await user.click(technicalSummary!);
    expect(technicalDisclosure).toHaveAttribute("open");
  });

  it("explains development initialization without exposing seeded English labels", async () => {
    const user = userEvent.setup();
    renderViewer([makeAuditEvent({
      subject: { type: "seed", id: "development-database", label: "Initialized development data" },
      action: "init",
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "type", value: { type: "code", value: "local" } }],
      },
    })]);

    const rowButton = screen.getByRole("button", { name: /GuildAdmin initialized the development data/i });
    expect(rowButton).not.toHaveTextContent("Initialized development data");
    expect(within(rowButton).queryByText("Local environment")).not.toBeInTheDocument();

    await user.click(rowButton);
    expect(screen.getByText("Local environment")).toBeVisible();
    expect(screen.getByRole("button", { name: "View activity for “System”" })).toBeVisible();
  });

  it("separates Chinese sentence particles from dynamic audit subjects", () => {
    const zh = JSON.parse(readFileSync(
      resolve(process.cwd(), "apps/portal/i18n/zh/admin.json"),
      "utf8",
    )) as Record<string, string>;

    /* 主体名是用户起的任意文本，紧贴在汉字上会读成一个词。每句都要留出空格，
       句尾则允许直接接标点。 */
    const glued = Object.entries(zh)
      .filter(([key, value]) => key.startsWith("audit.sentence.") && value.includes("<subject>"))
      .filter(([, value]) => !/ <subject>/.test(value) || !/<\/subject>[ ，。]/.test(value))
      .map(([key]) => key);

    expect(glued).toEqual([]);
  });

  it("keeps the localized system-test result and discards unsafe historical error payloads", async () => {
    const user = userEvent.setup();
    renderViewer([makeAuditEvent({
      subject: { type: "system_test", id: "admin-console-api", label: null },
      action: "run",
      payload: {
        schema_version: 2,
        changes: [],
        context: [
          { field: "total", value: { type: "number", value: 48 } },
          { field: "passed", value: { type: "number", value: 47 } },
          { field: "errors", value: { type: "text", value: '[{"path":"/api/auth/login"}]' } },
        ],
      },
    })]);

    expect(screen.getByText("GuildAdmin completed the full system test: 47/48 passed.")).toBeVisible();
    expect(document.body).not.toHaveTextContent("/api/auth/login");
    await user.click(screen.getByRole("button", { name: /completed the full system test/ }));
    expect(screen.getByText("Detailed values are unavailable for this record")).toBeVisible();
    expect(document.body).not.toHaveTextContent("/api/auth/login");
  });

  it("opens the exact subject timeline from the final expanded action", async () => {
    const user = userEvent.setup();
    const onSelectEntityTimeline = vi.fn();
    renderViewer([makeAuditEvent()], { onSelectEntityTimeline });

    await user.click(screen.getByRole("button", { name: /GuildAdmin.*Guild settings/ }));
    await user.click(screen.getByRole("button", { name: "View activity for “Guild settings”" }));
    expect(onSelectEntityTimeline).toHaveBeenCalledWith("site_config", "site-config");
  });

  it("mounts a long value only when the user explicitly asks for it", async () => {
    const user = userEvent.setup();
    const tail = "__AUDIT_VALUE_TAIL__";
    renderViewer([makeAuditEvent({
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "notes", value: { type: "text", value: `${"n".repeat(20 * 1_024)}${tail}` } }],
      },
    })]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin.*Guild settings/ }));
    expect(document.body).not.toHaveTextContent(tail);
    const showFull = screen.getByRole("button", { name: "Show full" });
    expect(showFull).toHaveAttribute("aria-expanded", "false");
    await user.click(showFull);
    expect(document.body).toHaveTextContent(tail);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("loads the next stable cursor page without numbered pagination", async () => {
    const user = userEvent.setup();
    const onAuditLoadMore = vi.fn();
    renderViewer([makeAuditEvent()], { auditHasMore: true, onAuditLoadMore });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(onAuditLoadMore).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("pagination.page")).not.toBeInTheDocument();
  });
});

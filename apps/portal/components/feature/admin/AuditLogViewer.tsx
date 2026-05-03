import type { AuditLogEntry } from "@guild/shared";
import { Alert, Badge, Group, Pagination, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowRight, IconChevronDown } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "./AuditLogViewer.css";

type AuditRow = AuditLogEntry;

type AuditLogViewerProps = {
  auditLoading: boolean;
  auditError: boolean;
  loadErrorMessage: string;
  auditRows: AuditRow[];
  auditPageCurrent: number;
  auditPageSize: number;
  auditTotal: number;
  onAuditPageChange: (nextPage: number) => void;
  isAdmin: boolean;
  maskIdentifier: (value: string, isAdmin: boolean) => string;
  formatAuditDiffHeader: (diffTitle: string | null, detailText: string | null) => string;
  formatDateTime: (iso: string | null) => string;
  userMap?: Map<string, string>;
};

function formatEntityId(
  entityId: string,
  entityType: string,
  userMap?: Map<string, string>,
  diffTitle?: string | null,
): string {
  if (entityType === "event_participant") {
    const parts = diffTitle?.split(" | ");
    if (parts && parts.length >= 2) {
      return `${parts[0]} · ${parts[1]}`;
    }
    const [eventPart, userId] = entityId.split(":");
    const userName = userId ? userMap?.get(userId) : undefined;
    if (userName) return userName;
    if (userId) {
      return userMap?.get(userId) ?? `${userId.slice(0, 6)}…`;
    }
    return eventPart?.slice(0, 8) + "…";
  }
  if (diffTitle) return diffTitle;
  if (userMap?.has(entityId)) {
    return userMap.get(entityId)!;
  }
  if (entityId === "batch" || entityId === "default" || entityId === "audit-log") {
    return "";
  }
  if (entityId.length > 12) {
    return `${entityId.slice(0, 8)}…`;
  }
  return entityId;
}

type DiffEntry = { field: string; from: string; to: string };
type InfoEntry = { field: string; value: string };
type DetailData =
  | { kind: "diff"; entries: DiffEntry[] }
  | { kind: "info"; entries: InfoEntry[] }
  | null;

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") return String(value);
  const str = String(value);
  if (str.length > 60) return `${str.slice(0, 57)}…`;
  return str;
}

function formatInfoValue(value: unknown, userMap?: Map<string, string>): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const resolved = value.map((v) => {
      const s = String(v);
      return userMap?.get(s) ?? s;
    });
    if (resolved.length <= 5) return resolved.join(", ");
    return `${resolved.slice(0, 5).join(", ")} (+${resolved.length - 5})`;
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    if (json.length > 60) return `${json.slice(0, 57)}…`;
    return json;
  }
  const str = String(value);
  if (userMap?.has(str)) return userMap.get(str)!;
  if (str.length > 60) return `${str.slice(0, 57)}…`;
  return str;
}

function parseDetailData(
  detailText: string | null,
  t?: (key: string, opts?: Record<string, unknown>) => string,
  userMap?: Map<string, string>,
): DetailData {
  if (!detailText) return null;
  try {
    const parsed = JSON.parse(detailText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) return null;

      const isDiffFormat = entries.every(
        ([, v]) => v && typeof v === "object" && !Array.isArray(v) && "from" in (v as object) && "to" in (v as object),
      );

      if (isDiffFormat) {
        return {
          kind: "diff",
          entries: entries.map(([field, val]) => {
            const { from, to } = val as { from: unknown; to: unknown };
            const label = t?.(`audit.field.${field}`, { defaultValue: field }) ?? field;
            return { field: label, from: formatDiffValue(from), to: formatDiffValue(to) };
          }),
        };
      }

      return {
        kind: "info",
        entries: entries.map(([field, val]) => {
          const label = t?.(`audit.field.${field}`, { defaultValue: field }) ?? field;
          return { field: label, value: formatInfoValue(val, userMap) };
        }),
      };
    }
  } catch {
    if (detailText.trim().length > 0) {
      return { kind: "info", entries: [{ field: "detail", value: detailText }] };
    }
  }
  return null;
}

function formatPrimaryText(
  diffTitle: string | null,
  detailData: DetailData,
  entityType: string,
): string {
  const header = diffTitle?.trim() || null;

  if (entityType === "event_participant" && header) {
    const parts = header.split(" | ");
    if (parts.length >= 2) return `${parts[0]} · ${parts[1]}`;
    return header;
  }

  if (header) return header;

  if (detailData) {
    const fields = detailData.entries.map((e) => e.field);
    if (fields.length > 0 && fields.length <= 3) return fields.join(", ");
    if (fields.length > 3) return `${fields.slice(0, 3).join(", ")} +${fields.length - 3}`;
  }

  return "—";
}

type ActionColor = "blue" | "green" | "red" | "yellow" | "grape" | "cyan" | "orange" | "gray";

function getActionColor(action: string): ActionColor {
  if (action === "create" || action === "init" || action === "admin_create_member" || action === "create_video") return "green";
  if (action === "delete" || action === "remove_by_moderator" || action === "batch_delete") return "red";
  if (action === "update" || action === "role_change" || action === "password_reset" || action === "update_role" || action === "batch_role_update" || action === "batch_update" || action === "set_role_tag" || action === "change_username") return "blue";
  if (action === "archive" || action === "pause" || action === "deactivate" || action === "batch_deactivate") return "yellow";
  if (action === "join" || action === "add_by_moderator") return "cyan";
  if (action === "leave") return "orange";
  if (action === "upload" || action === "upload_images") return "grape";
  if (action === "resume" || action === "reactivate" || action === "unarchive" || action === "batch_reactivate") return "green";
  if (action === "change_password" || action === "reset_password") return "orange";
  if (action === "revoke") return "red";
  if (action === "save_teams" || action === "move_member") return "blue";
  if (action.startsWith("export") || action.startsWith("download")) return "gray";
  return "blue";
}

function getEntityColor(entityType: string): ActionColor {
  if (entityType === "event" || entityType === "event_participant") return "blue";
  if (entityType === "recurring_template") return "grape";
  if (entityType === "announcement") return "cyan";
  if (entityType === "user" || entityType === "member_profile" || entityType === "user_auth") return "green";
  if (entityType === "invite_link") return "orange";
  if (entityType === "role") return "yellow";
  if (entityType === "guild_war" || entityType === "guild_war_history" || entityType === "guild_war_member_stats") return "red";
  if (entityType === "gallery" || entityType === "gallery_item" || entityType === "gallery_comment") return "grape";
  if (entityType === "wiki_article" || entityType === "wiki_category") return "cyan";
  if (entityType === "audit_log_export" || entityType === "audit_archive_export") return "gray";
  if (entityType === "analytics_settings") return "blue";
  return "gray";
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return "";
}

export function AuditLogViewer({
  auditLoading,
  auditError,
  loadErrorMessage,
  auditRows,
  auditPageCurrent,
  auditPageSize,
  auditTotal,
  onAuditPageChange,
  isAdmin,
  maskIdentifier,
  formatAuditDiffHeader: _formatAuditDiffHeader,
  formatDateTime,
  userMap,
}: AuditLogViewerProps) {
  const { t } = useTranslation("admin");
  const totalPages = Math.max(1, Math.ceil(auditTotal / Math.max(1, auditPageSize)));
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const resolveEntityType = (raw: string) =>
    t(`audit.entityType.${raw}`, { defaultValue: raw });

  const resolveAction = (raw: string) =>
    t(`audit.action.${raw}`, { defaultValue: raw });

  const resolveActor = (actorId: string) => {
    if (userMap?.has(actorId)) return userMap.get(actorId)!;
    return maskIdentifier(actorId, isAdmin);
  };

  const rows = useMemo(() => auditRows.map((row) => {
    const detailData = parseDetailData(row.detail_text, t, userMap);
    const primary = formatPrimaryText(row.diff_title, detailData, row.entity_type);
    return {
      ...row,
      resolvedEntityType: resolveEntityType(row.entity_type),
      resolvedAction: resolveAction(row.action),
      resolvedActor: resolveActor(String(row.actor_id ?? "")),
      resolvedTarget: formatEntityId(String(row.entity_id ?? ""), row.entity_type, userMap, row.diff_title),
      diffPrimary: primary,
      detailData,
      formattedTime: formatDateTime(row.created_at),
      relativeTime: formatRelativeTime(row.created_at),
      actionColor: getActionColor(row.action),
      entityColor: getEntityColor(row.entity_type),
    };
  }), [auditRows, t, maskIdentifier, formatDateTime, isAdmin, userMap]);

  return (
    <Stack gap={12}>
      {auditLoading ? (
        <Stack gap={8}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={64} radius="md" />
          ))}
        </Stack>
      ) : null}

      {auditError ? <Alert color="yellow" title={loadErrorMessage} /> : null}

      {!auditLoading && !auditError ? (
        <>
          {rows.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py={32}>
              {t("audit.noResults", { defaultValue: "No audit log entries found" })}
            </Text>
          ) : (
          <div className="audit-log-list">
            {rows.map((row) => {
              const isExpanded = expandedId === row.id;
              const hasDetail = row.detailData !== null;

              return (
                <div key={row.id} className={`audit-log-row ${isExpanded ? "audit-log-row--expanded" : ""}`}>
                  <button
                    type="button"
                    className="audit-log-row__header"
                    onClick={() => setExpandedId(isExpanded ? null : row.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className="audit-log-row__left">
                      <Badge
                        size="sm"
                        variant="light"
                        color={row.entityColor}
                        className="audit-log-row__entity-badge"
                      >
                        {row.resolvedEntityType}
                      </Badge>
                      <Badge
                        size="sm"
                        variant="dot"
                        color={row.actionColor}
                        className="audit-log-row__action-badge"
                      >
                        {row.resolvedAction}
                      </Badge>
                    </div>

                    <div className="audit-log-row__center">
                      <Text size="sm" fw={500} lineClamp={1} className="audit-log-row__diff-primary">
                        {row.diffPrimary}
                      </Text>
                      {hasDetail && !isExpanded ? (
                        <Text size="xs" c="dimmed" lineClamp={1} className="audit-log-row__diff-hint">
                          {row.detailData!.entries.map((d) => d.field).join(", ")}
                        </Text>
                      ) : null}
                    </div>

                    <div className="audit-log-row__meta">
                      <div className="audit-log-row__actors">
                        <Text size="xs" c="dimmed" className="audit-log-row__actor-label">
                          {row.resolvedActor}
                        </Text>
                        {row.resolvedTarget && row.resolvedTarget !== row.resolvedActor ? (
                          <Text size="xs" c="dimmed" className="audit-log-row__target-label">
                            → {row.resolvedTarget}
                          </Text>
                        ) : null}
                      </div>
                      <Tooltip label={row.formattedTime} position="left" withArrow>
                        <Text size="xs" c="dimmed" className="audit-log-row__time">
                          {row.relativeTime || row.formattedTime}
                        </Text>
                      </Tooltip>
                    </div>

                    {hasDetail ? (
                      <IconChevronDown
                        size={14}
                        className={`audit-log-row__chevron ${isExpanded ? "audit-log-row__chevron--open" : ""}`}
                      />
                    ) : (
                      <span className="audit-log-row__chevron-spacer" />
                    )}
                  </button>

                  {isExpanded && hasDetail ? (
                    <div className="audit-log-row__diff-panel">
                      {row.detailData!.kind === "diff" ? (
                        row.detailData!.entries.map((entry) => (
                          <div key={entry.field} className="audit-diff-entry">
                            <span className="audit-diff-entry__field">{entry.field}</span>
                            <span className="audit-diff-entry__from">{(entry as DiffEntry).from}</span>
                            <IconArrowRight size={12} className="audit-diff-entry__arrow" />
                            <span className="audit-diff-entry__to">{(entry as DiffEntry).to}</span>
                          </div>
                        ))
                      ) : (
                        row.detailData!.entries.map((entry) => (
                          <div key={entry.field} className="audit-info-entry">
                            <span className="audit-info-entry__field">{entry.field}</span>
                            <span className="audit-info-entry__value">{(entry as InfoEntry).value}</span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          )}

          <Group justify="flex-end">
            <Pagination
              value={auditPageCurrent}
              total={totalPages}
              onChange={onAuditPageChange}
              withEdges
              size="sm"
            />
          </Group>
        </>
      ) : null}
    </Stack>
  );
}

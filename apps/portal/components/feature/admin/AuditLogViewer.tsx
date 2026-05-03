import type { AuditLogEntry } from "@guild/shared";
import { Alert, Badge, Group, Pagination, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
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
): string {
  if (entityType === "event_participant") {
    const [, userId] = entityId.split(":");
    const userName = userId ? userMap?.get(userId) : undefined;
    if (userName) return userName;
    if (userId) {
      return userMap?.get(userId) ?? `${userId.slice(0, 6)}…`;
    }
  }
  if (userMap?.has(entityId)) {
    return userMap.get(entityId)!;
  }
  if (entityId.length > 12) {
    return `${entityId.slice(0, 8)}…`;
  }
  return entityId;
}

function formatDiffText(
  diffTitle: string | null,
  detailText: string | null,
  formatAuditDiffHeader: (d: string | null, t: string | null) => string,
  userMap?: Map<string, string>,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): { primary: string; secondary: string | null } {
  const header = diffTitle?.trim() || null;

  if (detailText) {
    try {
      const parsed = JSON.parse(detailText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed as Record<string, unknown>);
        const isDiffFormat = entries.length > 0 && entries.every(
          ([, v]) => v && typeof v === "object" && "from" in (v as object) && "to" in (v as object),
        );
        if (isDiffFormat && entries.length > 0) {
          const parts = entries.map(([field, val]) => {
            const { from, to } = val as { from: unknown; to: unknown };
            const label = t?.(`audit.field.${field}`, { defaultValue: field }) ?? field;
            return `${label}: ${formatDiffValue(from)} → ${formatDiffValue(to)}`;
          });
          return { primary: header ?? "-", secondary: parts.join(", ") };
        }
      }
    } catch {
      // not JSON, fall through
    }
  }

  const raw = formatAuditDiffHeader(diffTitle, detailText);
  if (!userMap || raw === "-") return { primary: raw, secondary: null };
  const resolved = raw.replace(
    /(?:user_id|actor_id):\s*([0-9a-f]{8}-[0-9a-f-]{27,})/gi,
    (_match, id: string) => {
      const name = userMap.get(id);
      return name ? `用户: ${name}` : `用户: ${id.slice(0, 8)}…`;
    },
  );
  return { primary: resolved, secondary: null };
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") return String(value);
  const str = String(value);
  if (str.length > 40) return `${str.slice(0, 37)}…`;
  return str;
}

type ActionColor = "blue" | "green" | "red" | "yellow" | "grape" | "cyan" | "orange" | "gray";

function getActionColor(action: string): ActionColor {
  if (action === "create" || action === "init") return "green";
  if (action === "delete" || action === "remove_by_moderator") return "red";
  if (action === "update" || action === "role_change" || action === "password_reset") return "blue";
  if (action === "archive" || action === "pause" || action === "deactivate") return "yellow";
  if (action === "join" || action === "add_by_moderator") return "cyan";
  if (action === "leave") return "orange";
  if (action === "upload" || action === "upload_images") return "grape";
  if (action === "resume" || action === "reactivate" || action === "unarchive") return "green";
  if (action.startsWith("export")) return "gray";
  return "blue";
}

function getEntityColor(entityType: string): ActionColor {
  if (entityType === "event" || entityType === "event_participant") return "blue";
  if (entityType === "recurring_template") return "grape";
  if (entityType === "announcement") return "cyan";
  if (entityType === "user" || entityType === "member_profile") return "green";
  if (entityType === "invite_link") return "orange";
  if (entityType === "role") return "yellow";
  if (entityType === "guild_war" || entityType === "war_history") return "red";
  if (entityType === "gallery" || entityType === "gallery_item") return "grape";
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
  formatAuditDiffHeader,
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
    const diff = formatDiffText(row.diff_title, row.detail_text, formatAuditDiffHeader, userMap, t);
    return {
      ...row,
      resolvedEntityType: resolveEntityType(row.entity_type),
      resolvedAction: resolveAction(row.action),
      resolvedActor: resolveActor(String(row.actor_id ?? "")),
      resolvedTarget: formatEntityId(String(row.entity_id ?? ""), row.entity_type, userMap),
      diffPrimary: diff.primary,
      diffSecondary: diff.secondary,
      formattedTime: formatDateTime(row.created_at),
      relativeTime: formatRelativeTime(row.created_at),
      actionColor: getActionColor(row.action),
      entityColor: getEntityColor(row.entity_type),
    };
  }), [auditRows, t, formatAuditDiffHeader, maskIdentifier, formatDateTime, isAdmin, userMap]);

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
          <div className="audit-log-list">
            {rows.map((row) => {
              const isExpanded = expandedId === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`audit-log-row ${isExpanded ? "audit-log-row--expanded" : ""}`}
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
                    {row.diffSecondary ? (
                      <Text size="xs" c="dimmed" lineClamp={isExpanded ? 10 : 1} className="audit-log-row__diff-secondary">
                        {row.diffSecondary}
                      </Text>
                    ) : null}
                  </div>

                  <div className="audit-log-row__meta">
                    <div className="audit-log-row__actors">
                      <Text size="xs" c="dimmed" className="audit-log-row__actor-label">
                        {row.resolvedActor}
                      </Text>
                      {row.resolvedTarget !== row.resolvedActor ? (
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
                </button>
              );
            })}
          </div>

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

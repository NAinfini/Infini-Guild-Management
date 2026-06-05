import type { AuditLogEntry } from "@guild/shared";
import type { AuditAction, AuditEntityType } from "@guild/shared/constants/audit";
import { Alert, Badge, Group, NumberInput, Pagination, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { ArrowRightIcon, ChevronDownIcon } from "@portal/components/icons";
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

type DiffEntry = { field: string; from: string; to: string };
type InfoEntry = { field: string; value: string };
type DetailData =
  | { kind: "diff"; entries: DiffEntry[] }
  | { kind: "info"; entries: InfoEntry[] }
  | null;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const str = String(value);
  if (ISO_DATE_RE.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    }
  }
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
    return JSON.stringify(value);
  }
  const str = String(value);
  if (userMap?.has(str)) return userMap.get(str)!;
  if (ISO_DATE_RE.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    }
  }
  return str;
}

function parseDetailData(
  detailText: string | null,
  t?: (key: string, opts?: Record<string, unknown>) => string,
  userMap?: Map<string, string>,
): DetailData {
  if (!detailText) return null;
  const HIDDEN_FIELDS = new Set(["password", "body_json"]);
  try {
    const parsed = JSON.parse(detailText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>)
        .filter(([field]) => !HIDDEN_FIELDS.has(field));
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

      const obj = parsed as Record<string, unknown>;
      const hiddenFields = new Set<string>();
      if ("usernames" in obj) hiddenFields.add("user_ids");
      if ("event_name" in obj) hiddenFields.add("event_id");
      if ("username" in obj) hiddenFields.add("user_id");

      return {
        kind: "info",
        entries: entries
          .filter(([field]) => !hiddenFields.has(field))
          .map(([field, val]) => {
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

type ActionColor = "blue" | "green" | "red" | "yellow" | "grape" | "cyan" | "orange" | "gray";

const ACTION_COLOR_MAP = {
  create: "green",
  init: "green",
  admin_create_member: "green",
  create_video: "green",
  register: "green",
  complete: "green",
  resume: "green",
  reactivate: "green",
  batch_reactivate: "green",
  delete: "red",
  batch_remove_by_moderator: "red",
  batch_delete: "red",
  revoke: "red",
  update: "blue",
  update_role: "blue",
  batch_role_update: "blue",
  batch_update: "blue",
  set_role_tag: "blue",
  change_username: "blue",
  save_teams: "blue",
  move_member: "blue",
  conclude: "blue",
  archive: "yellow",
  pause: "yellow",
  deactivate: "yellow",
  batch_deactivate: "yellow",
  join: "cyan",
  batch_add_by_moderator: "cyan",
  vote: "cyan",
  leave: "orange",
  change_password: "orange",
  reset_password: "orange",
  upload_images: "grape",
  upload_avatar: "grape",
  upload_audio: "grape",
  assign: "grape",
  unassign: "grape",
  delete_images: "grape",
  delete_avatar: "grape",
  delete_audio: "grape",
  export_filtered_csv: "gray",
  export_filtered_json: "gray",
  download_raw_ndjson_gz: "gray",
  raffle_draw: "cyan",
  rollback: "red",
  upload: "green",
  upload_icon: "grape",
} satisfies Record<AuditAction, ActionColor>;

const ENTITY_COLOR_MAP = {
  event: "blue",
  event_participant: "blue",
  event_poll_vote: "blue",
  analytics_settings: "blue",
  recurring_template: "grape",
  gallery: "grape",
  gallery_item: "grape",
  member_badge: "grape",
  badge: "grape",
  game_data: "grape",
  announcement: "cyan",
  wiki_article: "cyan",
  wiki_category: "cyan",
  user: "green",
  member_profile: "green",
  user_auth: "green",
  invite_link: "orange",
  role: "yellow",
  guild_war: "red",
  guild_war_history: "red",
  guild_war_member_stats: "red",
  audit_log_export: "gray",
  audit_archive_export: "gray",
  seed: "gray",
  wiki: "cyan",
} satisfies Record<AuditEntityType, ActionColor>;

function formatRelativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("audit.relativeTime.justNow");
  if (minutes < 60) return t("audit.relativeTime.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("audit.relativeTime.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("audit.relativeTime.daysAgo", { count: days });
  return "";
}

function buildSummaryParts(
  row: AuditRow,
  resolvedAction: string,
  resolvedEntityType: string,
  resolvedActor: string,
  detailData: DetailData,
): { summary: string; entityName: string | null; targetName: string | null } {
  const entityName = row.diff_title ?? null;

  let targetName: string | null = null;
  if (row.entity_type === "event_participant" && entityName) {
    const parts = entityName.split(" | ");
    if (parts.length >= 2) {
      targetName = parts[1]!;
      const eventName = parts[0]!;
      return {
        summary: `${resolvedActor} ${resolvedAction} ${resolvedEntityType}`,
        entityName: eventName,
        targetName,
      };
    }
  }

  let changedFieldsHint = "";
  if (detailData?.kind === "diff" && detailData.entries.length > 0) {
    const fields = detailData.entries.map((e) => e.field);
    changedFieldsHint = fields.length <= 3
      ? ` — ${fields.join(", ")}`
      : ` — ${fields.slice(0, 3).join(", ")} +${fields.length - 3}`;
  }

  return {
    summary: `${resolvedActor} ${resolvedAction} ${resolvedEntityType}${changedFieldsHint}`,
    entityName,
    targetName,
  };
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

  const rows = useMemo(() => {
    const resolveEntityType = (raw: string) =>
      t(`audit.entityType.${raw}`, { defaultValue: raw });

    const resolveAction = (raw: string) =>
      t(`audit.action.${raw}`, { defaultValue: raw });

    const resolveActor = (actorId: string, actorUsername?: string | null) => {
      if (actorUsername) return actorUsername;
      if (userMap?.has(actorId)) return userMap.get(actorId)!;
      return maskIdentifier(actorId, isAdmin);
    };

    return auditRows.map((row) => {
      const detailData = parseDetailData(row.detail_text, t, userMap);
      const resolvedAction = resolveAction(row.action);
      const resolvedEntityType = resolveEntityType(row.entity_type);
      const resolvedActor = resolveActor(String(row.actor_id ?? ""), row.actor_username);

      const { summary, entityName, targetName } = buildSummaryParts(
        row, resolvedAction, resolvedEntityType, resolvedActor, detailData,
      );

      return {
        ...row,
        resolvedEntityType,
        resolvedAction,
        resolvedActor,
        summary,
        entityName,
        targetName,
        detailData,
        formattedTime: formatDateTime(row.created_at),
        relativeTime: formatRelativeTime(row.created_at, t),
        actionColor: ACTION_COLOR_MAP[row.action],
        entityColor: ENTITY_COLOR_MAP[row.entity_type],
      };
    });
  }, [auditRows, t, maskIdentifier, formatDateTime, isAdmin, userMap]);

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
                    <div className="audit-log-row__badges">
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

                    <div className="audit-log-row__summary">
                      <Text size="sm" fw={500} lineClamp={1} className="audit-log-row__summary-text">
                        {row.summary}
                      </Text>
                      {row.entityName ? (
                        <Text size="xs" fw={600} c="var(--color-primary, #D4A843)" lineClamp={1} className="audit-log-row__entity-name">
                          {row.entityName}
                        </Text>
                      ) : null}
                      {row.targetName ? (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          → {row.targetName}
                        </Text>
                      ) : null}
                    </div>

                    <div className="audit-log-row__time-col">
                      <Tooltip label={row.formattedTime} position="left" withArrow>
                        <Text size="xs" c="dimmed" className="audit-log-row__time">
                          {row.relativeTime || row.formattedTime}
                        </Text>
                      </Tooltip>
                    </div>

                    {hasDetail ? (
                      <ChevronDownIcon
                        size={14}
                        className={`audit-log-row__chevron ${isExpanded ? "audit-log-row__chevron--open" : ""}`}
                      />
                    ) : (
                      <span className="audit-log-row__chevron-spacer" />
                    )}
                  </button>

                  {isExpanded && hasDetail ? (
                    <div className="audit-log-row__detail-panel">
                      <div className="audit-detail__header">
                        <Text size="xs" fw={600} tt="uppercase" c="dimmed" className="audit-detail__title">
                          {row.detailData!.kind === "diff" ? t("audit.detail.changes") : t("audit.detail.info")}
                        </Text>
                      </div>
                      {row.detailData!.kind === "diff" ? (
                        <div className="audit-detail__table">
                          <div className="audit-detail__table-head">
                            <span className="audit-detail__col-field">{t("audit.detail.field")}</span>
                            <span className="audit-detail__col-from">{t("audit.detail.before")}</span>
                            <span className="audit-detail__col-arrow" />
                            <span className="audit-detail__col-to">{t("audit.detail.after")}</span>
                          </div>
                          {row.detailData!.entries.map((entry) => (
                            <div key={entry.field} className="audit-diff-entry">
                              <span className="audit-diff-entry__field">{entry.field}</span>
                              <span className="audit-diff-entry__from">{(entry as DiffEntry).from}</span>
                              <ArrowRightIcon size={12} className="audit-diff-entry__arrow" />
                              <span className="audit-diff-entry__to">{(entry as DiffEntry).to}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="audit-detail__table">
                          {row.detailData!.entries.map((entry) => (
                            <div key={entry.field} className="audit-info-entry">
                              <span className="audit-info-entry__field">{entry.field}</span>
                              <span className="audit-info-entry__value">{(entry as InfoEntry).value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          )}

          <Group justify="flex-end" align="center" gap={8}>
            <Pagination
              value={auditPageCurrent}
              total={totalPages}
              onChange={onAuditPageChange}
              withEdges
              size="sm"
            />
            <NumberInput
              size="xs"
              min={1}
              max={totalPages}
              value={auditPageCurrent}
              onChange={(val) => {
                if (typeof val === "number" && val >= 1 && val <= totalPages) {
                  onAuditPageChange(val);
                }
              }}
              hideControls
              style={{ width: 56 }}
              styles={{ input: { textAlign: "center" } }}
            />
            <Text size="sm" c="dimmed">/ {totalPages}</Text>
          </Group>
        </>
      ) : null}
    </Stack>
  );
}

import type {
  AdminRole,
  AuditEvent,
  AuditField,
  AuditValue,
} from "@guild/shared";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  KeyIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
  UserPlusIcon,
} from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { formatLocaleDateTime } from "@portal/utils/datetime";
import type { TFunction } from "i18next";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import "./AuditLogViewer.css";
import { AdminLoadError } from "./AdminLoadError";
import {
  ACTION_FAMILY,
  type ActionFamily,
  contextLabel,
  contextNumber,
  formatAuditValue,
  formatRelativeTime,
  rawAuditValue,
  resolveReference,
  safeLabel,
  TECHNICAL_FIELDS,
} from "./audit-presentation";

type AuditLogViewerProps = {
  auditLoading: boolean;
  auditError: boolean;
  onRetryAudit: () => void;
  auditRows: AuditEvent[];
  auditHasMore: boolean;
  auditLoadingMore: boolean;
  onAuditLoadMore: () => void;
  onSelectEntityTimeline: (entityType: string, entityId: string) => void;
  rolesData: AdminRole[];
  userMap?: Map<string, string>;
};

const AUDIT_VALUE_PREVIEW_LENGTH = 360;

function ActionGlyph({ family }: { family: ActionFamily }) {
  const props = { size: 15, "aria-hidden": true } as const;
  if (family === "create") return <PlusIcon {...props} />;
  if (family === "change") return <PencilIcon {...props} />;
  if (family === "remove") return <TrashIcon {...props} />;
  if (family === "state") return <ArchiveIcon {...props} />;
  if (family === "membership") return <UserPlusIcon {...props} />;
  if (family === "media") return <UploadIcon {...props} />;
  if (family === "export") return <ArrowDownIcon {...props} />;
  if (family === "security") return <KeyIcon {...props} />;
  return <BoltIcon {...props} />;
}

function EventDescription({
  event,
  actorLabel,
  subjectLabel,
  inviteSubjectLabel,
  entityLabel,
  t,
}: {
  event: AuditEvent;
  actorLabel: string;
  subjectLabel: string | null;
  inviteSubjectLabel: string | null;
  entityLabel: string;
  t: TFunction<"admin">;
}) {
  // The self-test is the one action whose sentence carries its own outcome, so it reads the counts directly.
  if (event.subject.type === "system_test" && event.action === "run") {
    const passed = contextNumber(event.payload.context, "passed");
    const total = contextNumber(event.payload.context, "total");
    if (passed !== null && total !== null) {
      return (
        <Trans
          t={t}
          i18nKey="audit.sentence.system_test.run"
          values={{ actor: actorLabel, passed, total }}
          components={{ actor: <strong /> }}
        />
      );
    }
  }
  /* Two subjects are not named by their own label: an invite link is recognisable only by the role it
     grants, and a seeded row carries developer-facing English that no localized sentence may repeat. */
  const subject = event.subject.type === "invite_link"
    ? inviteSubjectLabel
    : event.subject.type === "seed"
      ? null
      : subjectLabel;
  const variant = subject ? "" : ".noSubject";
  return (
    <Trans
      t={t}
      i18nKey={[
        `audit.sentence.${event.subject.type}.${event.action}${variant}`,
        `audit.sentence.${event.action}${variant}`,
      ]}
      values={{ actor: actorLabel, subject, entity: entityLabel }}
      components={{ actor: <strong />, subject: <strong /> }}
    />
  );
}

function AuditValueText({ value, className, t }: { value: string; className?: string; t: TFunction<"admin"> }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (value.length <= AUDIT_VALUE_PREVIEW_LENGTH) return <span className={className}>{value}</span>;
  return (
    <span className="audit-detail-value">
      <span id={contentId} className={className}>
        {expanded ? value : (
          <>{value.slice(0, AUDIT_VALUE_PREVIEW_LENGTH)}<span className="audit-detail-value__truncated">{t("audit.detail.truncated")}</span></>
        )}
      </span>
      <button
        type="button"
        className="audit-detail-value__toggle"
        aria-controls={contentId}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {t(expanded ? "audit.detail.showLess" : "audit.detail.showFull")}
      </button>
    </span>
  );
}

function TechnicalRow({ label, value, copyValue, t }: { label: string; value: string; copyValue: string; t: TFunction<"admin"> }) {
  const [copied, setCopied] = useState(false);
  const clearCopiedTimer = useRef<number | undefined>(undefined);
  const copyLabel = t(copied ? "audit.technical.copied" : "audit.technical.copy", { field: label });

  useEffect(() => () => {
    if (clearCopiedTimer.current !== undefined) window.clearTimeout(clearCopiedTimer.current);
  }, []);

  const copy = () => {
    void navigator.clipboard.writeText(copyValue).then(() => {
      setCopied(true);
      if (clearCopiedTimer.current !== undefined) window.clearTimeout(clearCopiedTimer.current);
      clearCopiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        clearCopiedTimer.current = undefined;
      }, 1_500);
    });
  };

  return (
    <div className="audit-technical-row">
      <dt>{label}</dt>
      <dd><AuditValueText value={value} className="audit-technical-row__value" t={t} /></dd>
      <Tooltip>
        <TooltipTrigger render={(
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copyLabel}
            onClick={copy}
          />
        )}>
          {copied ? <CheckIcon size={14} aria-hidden /> : <CopyIcon size={14} aria-hidden />}
        </TooltipTrigger>
        <TooltipContent>{copyLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function AuditLogViewer({
  auditLoading,
  auditError,
  onRetryAudit,
  auditRows,
  auditHasMore,
  auditLoadingMore,
  onAuditLoadMore,
  onSelectEntityTimeline,
  rolesData,
  userMap,
}: AuditLogViewerProps) {
  const { t, i18n } = useTranslation("admin");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rolesById = useMemo(
    () => new Map(rolesData.map((role) => [role.id, role.name])),
    [rolesData],
  );

  const rows = useMemo(() => auditRows.map((event) => {
    const roleNameFallback = contextLabel(event.payload.context, "role_name", t);
    const hasRoleReference = event.payload.context.some((entry) => entry.field === "role_id");
    const formatValue = (value: AuditValue, field: AuditField, technical = false) => formatAuditValue(
      value,
      field,
      i18n.language,
      t,
      rolesById,
      userMap,
      roleNameFallback,
      technical,
    );
    const changes = event.payload.changes
      .filter((entry) => !TECHNICAL_FIELDS.has(entry.field))
      .map((entry) => ({
        ...entry,
        label: t(`audit.field.${entry.field}`),
        beforeText: formatValue(entry.before, entry.field),
        afterText: formatValue(entry.after, entry.field),
      }));
    const context = event.payload.context
      .filter((entry) => !TECHNICAL_FIELDS.has(entry.field))
      .filter((entry) => !(entry.field === "role_name" && hasRoleReference))
      .map((entry) => ({
        ...entry,
        label: t(event.subject.type === "seed" && entry.field === "type"
          ? "audit.detail.environment"
          : event.subject.type === "invite_link" && (entry.field === "role_id" || entry.field === "role_name")
            ? "audit.detail.grantedRole"
            : `audit.field.${entry.field}`),
        valueText: formatValue(entry.value, entry.field),
      }));
    if (event.subject.type === "invite_link" && event.action === "create") {
      if (!event.payload.context.some(({ field }) => field === "role_id" || field === "role_name")) {
        context.unshift({
          field: "role_id",
          value: { type: "null", value: null },
          label: t("audit.detail.grantedRole"),
          valueText: t("audit.detail.notRecorded"),
        });
      }
      if (!event.payload.context.some(({ field }) => field === "expires_at")) {
        context.push({
          field: "expires_at",
          value: { type: "null", value: null },
          label: t("audit.field.expires_at"),
          valueText: t("audit.detail.notRecorded"),
        });
      }
    }
    const technical = [
      { key: "event_id", label: t("audit.technical.eventId"), value: event.event_id, copyValue: event.event_id },
      { key: "request_id", label: t("audit.technical.requestId"), value: event.request_id, copyValue: event.request_id },
      { key: "actor_id", label: t("audit.technical.actorId"), value: event.actor.id, copyValue: event.actor.id },
      { key: "subject_id", label: t("audit.technical.subjectId"), value: event.subject.id, copyValue: event.subject.id },
      ...event.payload.context
        .filter((entry) => TECHNICAL_FIELDS.has(entry.field))
        .map((entry) => ({
          key: entry.field,
          label: t(`audit.field.${entry.field}`),
          value: formatValue(entry.value, entry.field, true),
          copyValue: rawAuditValue(entry.value),
        })),
      ...event.payload.changes
        .filter((entry) => TECHNICAL_FIELDS.has(entry.field))
        .map((entry) => ({
          key: `${entry.field}-change`,
          label: t(`audit.field.${entry.field}`),
          value: t("audit.technical.change", {
            before: formatValue(entry.before, entry.field, true),
            after: formatValue(entry.after, entry.field, true),
          }),
          copyValue: JSON.stringify({ before: rawAuditValue(entry.before), after: rawAuditValue(entry.after) }),
        })),
    ];
    const actorLabel = safeLabel(event.actor.label, t)
      ?? (event.actor.kind === "system"
        ? t("audit.actor.system")
        : userMap?.get(event.actor.id) ?? t("audit.actor.unknown"));
    const subjectLabel = safeLabel(event.subject.label, t);
    const roleReference = event.payload.context.find((entry) => entry.field === "role_id")?.value;
    const inviteSubjectLabel = roleReference?.type === "reference"
      ? resolveReference(roleReference.value, "role_id", t, rolesById, userMap, roleNameFallback, false)
      : roleNameFallback;
    const entityLabel = t(`audit.entityType.${event.subject.type}`);
    return {
      event,
      actorLabel,
      subjectLabel,
      inviteSubjectLabel,
      actionLabel: t(`audit.action.${event.action}`),
      entityLabel,
      timelineLabel: event.subject.type === "seed" ? entityLabel : subjectLabel ?? entityLabel,
      family: ACTION_FAMILY[event.action],
      changes,
      context,
      technical,
      formattedTime: formatLocaleDateTime(event.occurred_at, i18n.language, "medium"),
      relativeTime: formatRelativeTime(event.occurred_at, t),
    };
  }), [auditRows, i18n.language, rolesById, t, userMap]);

  return (
    <div className="admin-fill audit-log-viewer">
      {auditLoading ? (
        <LoadingIndicator />
      ) : null}

      {auditError ? <AdminLoadError onRetry={onRetryAudit} /> : null}

      {!auditLoading && !auditError ? (
        <>
          {rows.length === 0 ? (
            <p className="audit-log-empty">{t("audit.noResults")}</p>
          ) : (
            <div className="admin-panel audit-log-list">
              <div className="admin-panel__body admin-panel__body--flush admin-panel__body--scroll">
                {rows.map((row, index) => {
                  const { event } = row;
                  const isExpanded = expandedId === event.event_id;
                  const detailsId = `audit-event-details-${index}`;
                  return (
                    <article key={event.event_id} className="audit-log-row">
                      <button
                        type="button"
                        className="audit-log-row__header"
                        onClick={() => setExpandedId(isExpanded ? null : event.event_id)}
                        aria-expanded={isExpanded}
                        aria-controls={detailsId}
                      >
                        <span className="audit-log-row__icon" data-family={row.family} aria-hidden="true">
                          <ActionGlyph family={row.family} />
                        </span>

                        <span className="audit-log-row__content">
                          <span className="audit-log-row__description">
                            <EventDescription
                              event={event}
                              actorLabel={row.actorLabel}
                              subjectLabel={row.subjectLabel}
                              inviteSubjectLabel={row.inviteSubjectLabel}
                              entityLabel={row.entityLabel}
                              t={t}
                            />
                          </span>
                          <span className="audit-log-row__meta">
                            <span>{row.entityLabel}</span><span aria-hidden>·</span><span>{row.actionLabel}</span>
                          </span>
                        </span>

                        <Tooltip>
                          <TooltipTrigger render={(
                            <time dateTime={event.occurred_at} className="audit-log-row__time" />
                          )}>
                            {row.relativeTime || row.formattedTime}
                          </TooltipTrigger>
                          <TooltipContent side="left">{row.formattedTime}</TooltipContent>
                        </Tooltip>
                        <ChevronDownIcon
                          size={14}
                          aria-hidden
                          className="audit-log-row__chevron"
                          data-expanded={isExpanded || undefined}
                        />
                      </button>

                      {isExpanded ? (
                        <div id={detailsId} className="audit-log-row__details" role="region" aria-label={t("audit.detail.region", { event: row.entityLabel })}>
                          {row.changes.length > 0 ? (
                            <section className="audit-detail-section">
                              <h3 className="audit-detail-section__title">{t("audit.detail.changes")}</h3>
                              <div className="audit-change-list">
                                {row.changes.map((entry) => (
                                  <div key={entry.field} className="audit-change-row">
                                    <span className="audit-change-row__field">{entry.label}</span>
                                    <span className="audit-change-row__value">
                                      <span className="audit-change-row__value-label">{t("audit.detail.before")}</span>
                                      <AuditValueText value={entry.beforeText} t={t} />
                                    </span>
                                    <ArrowRightIcon size={14} aria-hidden className="audit-change-row__arrow" />
                                    <span className="audit-change-row__value audit-change-row__value--after">
                                      <span className="audit-change-row__value-label">{t("audit.detail.after")}</span>
                                      <AuditValueText value={entry.afterText} t={t} />
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ) : null}

                          {row.context.length > 0 ? (
                            <section className="audit-detail-section audit-context-section">
                              <h3 className="audit-detail-section__title">{t("audit.detail.context")}</h3>
                              <dl className="audit-context-list">
                                {row.context.map((entry) => (
                                  <div key={entry.field} className="audit-context-row">
                                    <dt>{entry.label}</dt>
                                    <dd><AuditValueText value={entry.valueText} t={t} /></dd>
                                  </div>
                                ))}
                              </dl>
                            </section>
                          ) : null}

                          <details className="audit-detail-disclosure audit-technical-disclosure">
                            <summary className="audit-detail-disclosure__summary">
                              <span role="heading" aria-level={3} className="audit-detail-disclosure__title">
                                {t("audit.technical.title")}
                              </span>
                              <ChevronDownIcon size={14} aria-hidden className="audit-detail-disclosure__chevron" />
                            </summary>
                            <div className="audit-detail-disclosure__content">
                              <p className="audit-technical-disclosure__hint">{t("audit.technical.description")}</p>
                              <dl className="audit-technical-list">
                                {row.technical.map(({ key, ...entry }) => <TechnicalRow key={key} {...entry} t={t} />)}
                              </dl>
                            </div>
                          </details>

                          <div className="audit-detail-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onSelectEntityTimeline(event.subject.type, event.subject.id)}
                            >
                              {t("audit.timeline.view", { entity: row.timelineLabel })}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {auditHasMore ? (
            <div className="audit-log-load-more">
              <Button variant="default" loading={auditLoadingMore} onClick={onAuditLoadMore}>{t("audit.loadMore")}</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

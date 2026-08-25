import type {
  AuditAction,
  AuditContext,
  AuditField,
  AuditValue,
} from "@guild/shared";
import { AUDIT_CODE_VALUES, AUDIT_ENTITY_TYPES, AUDIT_FIELDS, AUDIT_SECTION_KEYS } from "@guild/shared/constants/audit";
import { PERMISSIONS } from "@guild/shared/constants/roles";
import { formatCalendarDate, formatLocaleDateTime } from "@portal/utils/datetime";
import type { TFunction } from "i18next";

export type ActionFamily = "create" | "change" | "remove" | "state" | "membership" | "media" | "export" | "security" | "system";

export const ACTION_FAMILY = {
  admin_create_member: "create",
  archive: "state",
  adjust: "change",
  assign: "membership",
  batch_add_by_moderator: "membership",
  batch_deactivate: "state",
  batch_delete: "remove",
  batch_reactivate: "state",
  batch_remove_by_moderator: "remove",
  batch_role_update: "change",
  batch_update: "change",
  change_password: "security",
  change_username: "security",
  conclude: "change",
  create: "create",
  create_video: "media",
  deactivate: "state",
  delete: "remove",
  delete_audio: "remove",
  delete_avatar: "remove",
  delete_images: "remove",
  distribute: "change",
  export_filtered_csv: "export",
  export_filtered_json: "export",
  init: "create",
  intake: "create",
  join: "membership",
  leave: "remove",
  login_failed: "security",
  move_member: "change",
  pause: "state",
  publish: "change",
  raffle_draw: "change",
  reactivate: "state",
  register: "create",
  reorder: "change",
  reset_login_lock: "security",
  reset_password: "security",
  rollback: "state",
  run: "system",
  resume: "state",
  revoke: "remove",
  save_teams: "change",
  set_role_tag: "change",
  unassign: "remove",
  update: "change",
  update_role: "change",
  upload: "media",
  upload_audio: "media",
  upload_avatar: "media",
  upload_icon: "media",
  upload_images: "media",
  vote: "change",
  withdraw: "state",
} satisfies Record<AuditAction, ActionFamily>;

export const ACTION_COLOR = {
  create: "green",
  change: "blue",
  remove: "red",
  state: "yellow",
  membership: "cyan",
  media: "grape",
  export: "gray",
  security: "orange",
  system: "teal",
} satisfies Record<ActionFamily, string>;

const KNOWN_CODE_SET = new Set<string>(AUDIT_CODE_VALUES);
const AUDIT_FIELD_SET = new Set<string>(AUDIT_FIELDS);
const AUDIT_SECTION_SET = new Set<string>(AUDIT_SECTION_KEYS);
const PERMISSION_SET = new Set<string>(PERMISSIONS);
const AUDIT_ENTITY_TYPE_SET = new Set<string>(AUDIT_ENTITY_TYPES);
const PERMISSION_FIELDS = new Set<AuditField>(["permissions", "permissions_added", "permissions_removed"]);
const HIDDEN_STRUCTURED_FIELDS = new Set<AuditField>(["analytics_settings", "body", "errors"]);
export const TECHNICAL_FIELDS = new Set<AuditField>(["actor_id", "subject_id"]);
const USER_REFERENCE_FIELDS = new Set<AuditField>(["user_ids", "winner_user_ids"]);
/**
 * A sequence is the whole point of these fields, so they keep every entry instead of stopping after the
 * first few, and drop the final "and" / “和”, which reads as an unordered pair rather than a position.
 */
const ORDERED_LIST_FIELDS = new Set<AuditField>(["order"]);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const UUID_EXACT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN_PATTERN = /[A-Za-z0-9_-]{16,}/g;
function isOpaqueIdentifier(value: string): boolean {
  const compact = value.trim();
  if (UUID_EXACT_PATTERN.test(compact)) return true;
  if (compact.length < 16 || /\s/.test(compact)) return false;
  if (/^[a-f\d]{16,}$/i.test(compact)) return true;
  return /\d/.test(compact) && /[A-Za-z]/.test(compact) && /^[A-Za-z0-9_-]+$/.test(compact);
}

function safeBusinessText(value: string, t: TFunction<"admin">): string {
  const trimmed = value.trim();
  if (!trimmed) return t("audit.value.empty");
  if (isOpaqueIdentifier(trimmed)) return t("audit.value.technicalIdentifier");
  return value
    .replace(UUID_PATTERN, t("audit.value.technicalIdentifier"))
    .replace(OPAQUE_TOKEN_PATTERN, (candidate) => (
      isOpaqueIdentifier(candidate) ? t("audit.value.technicalIdentifier") : candidate
    ));
}

export function safeLabel(value: string | null, t: TFunction<"admin">): string | null {
  if (!value || isOpaqueIdentifier(value)) return null;
  return safeBusinessText(value, t);
}

function humanizeCode(value: string, locale: string, t: TFunction<"admin">): string {
  const normalized = value.trim().toLowerCase();
  if (KNOWN_CODE_SET.has(normalized)) return t(`audit.code.${normalized}`);
  const safe = safeBusinessText(value, t);
  if (safe === t("audit.value.technicalIdentifier")) return safe;
  const readable = safe
    .replace(/[._-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!readable) return t("audit.value.empty");
  return `${readable.charAt(0).toLocaleUpperCase(locale)}${readable.slice(1)}`;
}

function formatBusinessCode(value: string, field: AuditField, locale: string, t: TFunction<"admin">): string {
  const normalized = value.trim();
  if (field === "subject_type" && AUDIT_ENTITY_TYPE_SET.has(normalized)) {
    return t(`audit.entityType.${normalized}`);
  }
  if (PERMISSION_FIELDS.has(field) && PERMISSION_SET.has(normalized)) {
    return t(`roles.permission.${normalized}`);
  }
  if (field === "changed_sections") {
    if (AUDIT_SECTION_SET.has(normalized)) return t(`audit.section.${normalized}`);
    if (AUDIT_FIELD_SET.has(normalized)) return t(`audit.field.${normalized}`);
  }
  if (field === "color" || field === "slug" || field === "role_tags") {
    return safeBusinessText(value, t);
  }
  return humanizeCode(value, locale, t);
}

export function resolveReference(
  value: Extract<AuditValue, { type: "reference" }>["value"],
  field: AuditField,
  t: TFunction<"admin">,
  rolesById: ReadonlyMap<string, string>,
  userMap: ReadonlyMap<string, string> | undefined,
  roleNameFallback: string | null,
  technical: boolean,
): string {
  if (technical) return value.label ?? value.id;
  const label = safeLabel(value.label, t);
  if (label) return label;
  if (field === "role_id") {
    return rolesById.get(value.id) ?? roleNameFallback ?? t("audit.detail.notRecorded");
  }
  if (USER_REFERENCE_FIELDS.has(field)) {
    return userMap?.get(value.id) ?? t("audit.detail.notRecorded");
  }
  return t("audit.detail.notRecorded");
}

export function formatAuditValue(
  value: AuditValue,
  field: AuditField,
  locale: string,
  t: TFunction<"admin">,
  rolesById: ReadonlyMap<string, string>,
  userMap: ReadonlyMap<string, string> | undefined,
  roleNameFallback: string | null,
  technical = false,
): string {
  if (!technical && HIDDEN_STRUCTURED_FIELDS.has(field)) {
    return t("audit.value.structuredDetailsUnavailable");
  }
  if (value.type === "text") return technical ? value.value : safeBusinessText(value.value, t);
  if (value.type === "number") return new Intl.NumberFormat(locale).format(value.value);
  if (value.type === "boolean") return t(`audit.value.boolean.${value.value ? "true" : "false"}`);
  if (value.type === "date") return formatCalendarDate(value.value, locale, "medium");
  if (value.type === "datetime") return formatLocaleDateTime(value.value, locale, "medium");
  if (value.type === "code") return technical ? value.value : formatBusinessCode(value.value, field, locale, t);
  if (value.type === "reference") {
    return resolveReference(value.value, field, t, rolesById, userMap, roleNameFallback, technical);
  }
  if (value.type === "null") {
    return field === "expires_at" ? t("audit.value.null.never") : t("audit.value.null.default");
  }
  if (value.value.length === 0) return t("audit.value.list.empty");
  const ordered = ORDERED_LIST_FIELDS.has(field);
  const formatted = (ordered ? value.value : value.value.slice(0, 5)).map((item) => formatAuditValue(
    item,
    field,
    locale,
    t,
    rolesById,
    userMap,
    roleNameFallback,
    technical,
  ));
  if (!ordered && value.value.length > formatted.length) {
    formatted.push(t("audit.value.list.more", { count: value.value.length - formatted.length }));
  }
  return new Intl.ListFormat(locale, {
    style: ordered ? "narrow" : "short",
    type: "conjunction",
  }).format(formatted);
}

export function rawAuditValue(value: AuditValue): string {
  if (value.type === "reference") return value.value.id;
  if (value.type === "list") {
    return JSON.stringify(value.value.map((item) => (
      item.type === "reference" ? item.value.id : item.value
    )));
  }
  return String(value.value ?? "");
}

export function contextNumber(context: readonly AuditContext[], field: AuditField): number | null {
  const value = context.find((entry) => entry.field === field)?.value;
  return value?.type === "number" ? value.value : null;
}

export function contextLabel(context: readonly AuditContext[], field: AuditField, t: TFunction<"admin">): string | null {
  const value = context.find((entry) => entry.field === field)?.value;
  if (!value) return null;
  if (value.type === "text" || value.type === "code") return safeBusinessText(value.value, t);
  if (value.type === "reference") return safeLabel(value.value.label, t);
  return null;
}

export function formatRelativeTime(iso: string, t: TFunction<"admin">): string {
  const occurredAt = Date.parse(iso);
  if (!Number.isFinite(occurredAt)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - occurredAt) / 60_000));
  if (minutes < 1) return t("audit.relativeTime.justNow");
  if (minutes < 60) return t("audit.relativeTime.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("audit.relativeTime.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return days < 7 ? t("audit.relativeTime.daysAgo", { count: days }) : "";
}

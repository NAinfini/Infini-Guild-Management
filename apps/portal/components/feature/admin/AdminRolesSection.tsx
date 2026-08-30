import { PERMISSIONS, type AdminRole, type Permission } from "@guild/shared";
import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  BookTextIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClipboardIcon,
  EyeIcon,
  GalleryThumbnailsIcon,
  InfoCircleIcon,
  LockIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SettingsIcon,
  ShieldIcon,
  SwordsIcon,
  TrashIcon,
  UploadIcon,
  UserCheckIcon,
  WarehouseIcon,
  XIcon,
} from "@portal/components/icons";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { userCanManageRoles } from "../../../utils/permissions";
import { AdminLoadError } from "./AdminLoadError";

type RoleDraft = {
  revisionToken: string;
  name: string;
  level: number;
  color: string;
  permissions: Record<Permission, boolean>;
};

type RolePayload = {
  id?: string;
  name: string;
  level: number;
  color?: string | null;
  permissions?: Record<Permission, boolean>;
};

type RoleUpdatePayload = {
  expected_revision_token: string;
  name?: string;
  level?: number;
  color?: string | null;
  permissions?: Record<Permission, boolean>;
};

type AdminRolesSectionProps = {
  rolesLoading: boolean;
  rolesError: boolean;
  onRetryRoles: () => void;
  roles: AdminRole[];
  createRolePending: boolean;
  updateRolePending: boolean;
  isRoleDeletePending: (roleId: string) => boolean;
  onCreateRole: (payload: RolePayload) => Promise<boolean>;
  onUpdateRole: (roleId: string, payload: RoleUpdatePayload) => Promise<AdminRole | null>;
  onDeleteRole: (roleId: string) => Promise<boolean>;
};

type PermissionCategory = {
  labelKey: string;
  permissions: Permission[];
};

const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    labelKey: "roles.category.adminUsers",
    permissions: [
      "admin.users.view",
      "admin.users.edit",
      "admin.users.role",
      "admin.users.activate",
      "admin.users.delete",
      "admin.users.password",
    ],
  },
  {
    labelKey: "roles.category.adminInvites",
    permissions: ["admin.invite.view", "admin.invite.manage"],
  },
  {
    labelKey: "roles.category.adminAudit",
    permissions: ["admin.audit.view", "admin.audit.export"],
  },
  {
    labelKey: "roles.category.adminSystem",
    permissions: [
      "admin.status.view",
      "admin.roles.view",
      "admin.roles.manage",
      "admin.siteConfig.manage",
      "admin.importantNotices.manage",
      "admin.classes.manage",
      "admin.badges.manage",
    ],
  },
  {
    labelKey: "roles.category.storage",
    permissions: [
      "admin.storage.structure",
      "admin.storage.items",
      "admin.storage.stock",
    ],
  },
  {
    labelKey: "roles.category.adminAnalytics",
    permissions: ["admin.analytics.view", "admin.analytics.manage"],
  },
  {
    labelKey: "roles.category.guildWar",
    permissions: ["guildwar.teams.edit", "guildwar.history.edit"],
  },
  {
    labelKey: "roles.category.events",
    permissions: ["events.create", "events.edit", "events.archive", "events.delete", "events.templates"],
  },
  {
    labelKey: "roles.category.announcements",
    permissions: ["announcements.create", "announcements.edit", "announcements.archive", "announcements.delete"],
  },
  {
    labelKey: "roles.category.gallery",
    permissions: ["gallery.upload", "gallery.manage", "gallery.delete"],
  },
  {
    labelKey: "roles.category.wiki",
    permissions: ["wiki.articles.create", "wiki.articles.edit", "wiki.articles.archive", "wiki.articles.delete", "wiki.categories.manage"],
  },
];

type PermMeta = { icon: ReactNode; color: string; danger?: boolean };

const PERM_ICON_SIZE = 16;

const PERM_META: Record<Permission, PermMeta> = {
  "admin.users.view":      { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "gray" },
  "admin.users.edit":      { icon: <PencilIcon size={PERM_ICON_SIZE} />,            color: "teal" },
  "admin.users.role":      { icon: <ShieldIcon size={PERM_ICON_SIZE} />,             color: "violet" },
  "admin.users.activate":  { icon: <UserCheckIcon size={PERM_ICON_SIZE} />,          color: "orange" },
  "admin.users.delete":    { icon: <TrashIcon size={PERM_ICON_SIZE} />,              color: "red", danger: true },
  "admin.users.password":  { icon: <LockIcon size={PERM_ICON_SIZE} />,               color: "orange", danger: true },
  "admin.invite.view":     { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "gray" },
  "admin.invite.manage":   { icon: <PlusIcon size={PERM_ICON_SIZE} />,               color: "teal" },
  "admin.audit.view":      { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "gray" },
  "admin.audit.export":    { icon: <ArchiveIcon size={PERM_ICON_SIZE} />,            color: "grape" },
  "admin.status.view":     { icon: <SettingsIcon size={PERM_ICON_SIZE} />,           color: "gray" },
  "admin.roles.view":      { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "gray" },
  "admin.roles.manage":    { icon: <ShieldIcon size={PERM_ICON_SIZE} />,             color: "red", danger: true },
  "admin.siteConfig.manage": { icon: <SettingsIcon size={PERM_ICON_SIZE} />,         color: "teal" },
  "admin.importantNotices.manage": { icon: <InfoCircleIcon size={PERM_ICON_SIZE} />, color: "violet" },
  "admin.classes.manage":    { icon: <PaletteIcon size={PERM_ICON_SIZE} />,          color: "teal" },
  "admin.badges.manage":     { icon: <ShieldIcon size={PERM_ICON_SIZE} />,           color: "teal" },
  "admin.analytics.view":  { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "gray" },
  "admin.analytics.manage":{ icon: <SettingsIcon size={PERM_ICON_SIZE} />,           color: "teal" },
  "guildwar.teams.edit":   { icon: <SwordsIcon size={PERM_ICON_SIZE} />,             color: "orange" },
  "guildwar.history.edit": { icon: <SwordsIcon size={PERM_ICON_SIZE} />,             color: "orange" },
  "events.create":         { icon: <PlusIcon size={PERM_ICON_SIZE} />,               color: "teal" },
  "events.edit":           { icon: <PencilIcon size={PERM_ICON_SIZE} />,            color: "teal" },
  "events.archive":        { icon: <ArchiveIcon size={PERM_ICON_SIZE} />,            color: "grape" },
  "events.delete":         { icon: <TrashIcon size={PERM_ICON_SIZE} />,              color: "red", danger: true },
  "events.templates":      { icon: <CalendarDaysIcon size={PERM_ICON_SIZE} />,       color: "teal" },
  "announcements.create":  { icon: <PlusIcon size={PERM_ICON_SIZE} />,               color: "teal" },
  "announcements.edit":    { icon: <PencilIcon size={PERM_ICON_SIZE} />,            color: "teal" },
  "announcements.archive": { icon: <ArchiveIcon size={PERM_ICON_SIZE} />,            color: "grape" },
  "announcements.delete":  { icon: <TrashIcon size={PERM_ICON_SIZE} />,              color: "red", danger: true },
  "gallery.upload":        { icon: <UploadIcon size={PERM_ICON_SIZE} />,             color: "teal" },
  "gallery.manage":        { icon: <GalleryThumbnailsIcon size={PERM_ICON_SIZE} />,  color: "teal" },
  "gallery.delete":        { icon: <TrashIcon size={PERM_ICON_SIZE} />,              color: "red", danger: true },
  "wiki.articles.create":  { icon: <PlusIcon size={PERM_ICON_SIZE} />,               color: "teal" },
  "wiki.articles.edit":    { icon: <PencilIcon size={PERM_ICON_SIZE} />,            color: "teal" },
  "wiki.articles.archive": { icon: <ArchiveIcon size={PERM_ICON_SIZE} />,            color: "grape" },
  "wiki.articles.delete":  { icon: <TrashIcon size={PERM_ICON_SIZE} />,              color: "red", danger: true },
  "wiki.categories.manage":{ icon: <BookTextIcon size={PERM_ICON_SIZE} />,           color: "teal" },
  "admin.storage.structure": { icon: <WarehouseIcon size={PERM_ICON_SIZE} />,         color: "teal" },
  "admin.storage.items":     { icon: <PencilIcon size={PERM_ICON_SIZE} />,            color: "teal" },
  "admin.storage.stock":     { icon: <ClipboardIcon size={PERM_ICON_SIZE} />,         color: "orange" },
};

const DEFAULT_META: PermMeta = { icon: <SettingsIcon size={PERM_ICON_SIZE} />, color: "gray" };

function buildEmptyPermissions(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])) as Record<Permission, boolean>;
}

const DEFAULT_ROLE_COLOR = "#64748b";

const CSS_COLOR_TO_HEX: Record<string, string> = {
  red: "#ef4444",
  blue: "#D4A843",
  gray: DEFAULT_ROLE_COLOR,
  green: "#22c55e",
  orange: "#f97316",
  yellow: "#eab308",
  teal: "#14b8a6",
  purple: "#a855f7",
  pink: "#ec4899",
  indigo: "#6366f1",
};

function normalizeColor(color: string | null): string {
  if (!color) return "";
  const lower = color.trim().toLowerCase();
  return CSS_COLOR_TO_HEX[lower] ?? color;
}

function colorPickerValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ROLE_COLOR;
}

function roleToDraft(role: AdminRole): RoleDraft {
  return {
    revisionToken: role.revision_token,
    name: role.name,
    level: role.level,
    color: normalizeColor(role.color),
    permissions: { ...buildEmptyPermissions(), ...role.permissions },
  };
}

function isRoleDraftDirty(role: AdminRole, draft: RoleDraft | undefined): boolean {
  if (!draft) {
    return false;
  }

  if (draft.name.trim() !== role.name) {
    return true;
  }

  if (draft.level !== role.level) {
    return true;
  }

  if (draft.color.trim() !== normalizeColor(role.color)) {
    return true;
  }

  for (const permission of PERMISSIONS) {
    if (Boolean(draft.permissions[permission]) !== Boolean(role.permissions[permission])) {
      return true;
    }
  }

  return false;
}

export function AdminRolesSection({
  rolesLoading,
  rolesError,
  onRetryRoles,
  roles,
  createRolePending,
  updateRolePending,
  isRoleDeletePending,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
}: AdminRolesSectionProps) {
  const { t } = useTranslation("admin");
  const { t: common } = useTranslation("common");
  const confirm = useConfirmDialog();
  const user = useAuthStore((state) => state.user);
  const isAdmin = userCanManageRoles(user);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [createRoleName, setCreateRoleName] = useState("");
  const roleNameInputId = useId();
  const roleLevelInputId = useId();
  const roleColorInputId = useId();
  const roleColorPickerId = useId();
  const createRoleNameInputId = useId();

  const emptyPermissions = useMemo(() => buildEmptyPermissions(), []);
  const normalizedCreateRoleName = createRoleName.trim();
  const createRoleNameValid = normalizedCreateRoleName.length > 0 && normalizedCreateRoleName.length <= 80;
  const actorRoleLevel = user?.role_level ?? 0;
  const canCreateRoles = actorRoleLevel > 1;
  const isRoleEditable = (role: AdminRole) => Boolean(
    user && role.level <= actorRoleLevel,
  );
  const isRoleDeletable = (role: AdminRole) => Boolean(
    user && role.id !== user.role && role.level < actorRoleLevel,
  );

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, RoleDraft> = {};
      for (const role of roles) {
        const draft = current[role.id];
        next[role.id] = draft && isRoleDraftDirty(role, draft) ? draft : roleToDraft(role);
      }
      return next;
    });
  }, [roles]);

  useEffect(() => {
    if (roles.length === 0) {
      setSelectedRoleId(null);
      return;
    }
    if (selectedRoleId === null || !roles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(roles[0]?.id ?? null);
    }
  }, [roles, selectedRoleId]);

  if (!isAdmin) {
    return (
      <div className="admin-roles__status">
        <Alert variant="destructive">
          <AlertTitle>{t("adminOnly")}</AlertTitle>
        </Alert>
      </div>
    );
  }

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const selectedDraft = selectedRoleId ? drafts[selectedRoleId] : undefined;
  const isDirty = selectedRole && selectedDraft ? isRoleDraftDirty(selectedRole, selectedDraft) : false;
  const canEditSelectedRole = selectedRole ? isRoleEditable(selectedRole) : false;
  const canDeleteSelectedRole = selectedRole ? isRoleDeletable(selectedRole) : false;
  const editableRoleLevelMax = Math.min(1_000, actorRoleLevel);

  const openCreateRoleModal = () => {
    setCreateRoleName("");
    setCreateModalOpened(true);
  };

  const handleCreateRole = async () => {
    if (!createRoleNameValid || !canCreateRoles) return;

    const created = await onCreateRole({
      name: normalizedCreateRoleName,
      level: Math.min(100, actorRoleLevel - 1),
      color: null,
      permissions: emptyPermissions,
    });
    if (created) {
      setCreateModalOpened(false);
      setCreateRoleName("");
    }
  };

  const handleDeleteRole = async (role: AdminRole) => {
    if (!isRoleDeletable(role)) return;
    const confirmed = await confirm({
      title: t("roles.confirmDeleteTitle"),
      description: t("roles.confirmDeleteDescription", { name: role.name }),
      confirmLabel: t("roles.delete"),
      cancelLabel: t("roles.cancel"),
      intent: "danger",
    });

    if (!confirmed) {
      return;
    }

    const deleted = await onDeleteRole(role.id);
    if (deleted && selectedRoleId === role.id) {
      const remaining = roles.filter((r) => r.id !== role.id);
      setSelectedRoleId(remaining[0]?.id ?? null);
    }
  };

  const updateDraftField = (roleId: string, field: keyof RoleDraft, value: unknown) => {
    setDrafts((current) => {
      const existing = current[roleId];
      if (!existing) return current;
      return {
        ...current,
        [roleId]: { ...existing, [field]: value },
      };
    });
  };

  const togglePermission = (roleId: string, permission: Permission) => {
    setDrafts((current) => {
      const existing = current[roleId];
      if (!existing) return current;
      return {
        ...current,
        [roleId]: {
          ...existing,
          permissions: {
            ...existing.permissions,
            [permission]: !existing.permissions[permission],
          },
        },
      };
    });
  };

  const handleSaveRole = async (role: AdminRole, draft: RoleDraft) => {
    if (!isRoleEditable(role)) return;
    const removesCurrentPermission = role.id === user?.role && PERMISSIONS.some(
      (permission) => role.permissions[permission] === true && draft.permissions[permission] !== true,
    );

    if (removesCurrentPermission) {
      const confirmed = await confirm({
        title: t("roles.confirmSelfLockTitle"),
        description: t("roles.confirmSelfLockDescription"),
        confirmLabel: t("roles.confirmSelfLockConfirm"),
        cancelLabel: t("roles.cancel"),
        intent: "danger",
      });
      if (!confirmed) {
        return;
      }
    }

    const updated = await onUpdateRole(role.id, {
      expected_revision_token: draft.revisionToken,
      name: draft.name.trim(),
      level: draft.level,
      color: draft.color.trim() || null,
      permissions: draft.permissions,
    });
    if (updated) {
      setDrafts((current) => ({
        ...current,
        [role.id]: { ...draft, revisionToken: updated.revision_token },
      }));
    }
  };

  return (
    <div className="admin-fill admin-roles">
      {rolesLoading ? (
        <div className="admin-roles__loading">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton className="admin-md__skeleton" key={index} />)}
        </div>
      ) : null}
      {rolesError ? <AdminLoadError onRetry={onRetryRoles} /> : null}

      {!rolesLoading && !rolesError ? (
        <div className="admin-panel admin-md">
          <div className="admin-md__master">
            <div className="admin-md__master-head">
              <div className="admin-md__master-head-row">
                <span className="admin-md__master-title">{t("roles.listTitle")}</span>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        size="icon-sm"
                        onClick={openCreateRoleModal}
                        loading={createRolePending}
                        disabled={!canCreateRoles}
                        aria-label={t("roles.create")}
                      />
                    )}
                  >
                    <PlusIcon size={14} />
                  </TooltipTrigger>
                  <TooltipContent>{t("roles.create")}</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <ScrollArea className="admin-md__list">
              <div className="admin-md__list-stack">
                {roles.map((role) => {
                  const isSelected = role.id === selectedRoleId;
                  const roleDraft = drafts[role.id];
                  const dirty = roleDraft ? isRoleDraftDirty(role, roleDraft) : false;

                  return (
                    <div
                      key={role.id}
                      className={`admin-md__row ${isSelected ? "admin-md__row--active" : ""}`}
                    >
                      <button
                        type="button"
                        className={`admin-md__item ${isSelected ? "admin-md__item--active" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => setSelectedRoleId(role.id)}
                      >
                        <span className="admin-md__item-main">
                          <span
                            aria-hidden="true"
                            className="admin-roles__swatch"
                            style={role.color ? { backgroundColor: normalizeColor(role.color) } : undefined}
                          />
                          <span className="admin-md__item-label">{role.name}</span>
                        </span>
                        {dirty ? <Badge className="admin-md__dirty" variant="outline">*</Badge> : null}
                      </button>
                      <Button
                        type="button"
                        className="admin-md__row-action admin-roles__row-delete"
                        variant="destructive"
                        size="icon-xs"
                        onClick={() => { void handleDeleteRole(role); }}
                        loading={isRoleDeletePending(role.id)}
                        disabled={isRoleDeletePending(role.id) || !isRoleDeletable(role)}
                        aria-label={t("roles.delete")}
                      >
                        <XIcon size={12} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="admin-md__detail">
            {selectedRole && selectedDraft ? (
              <>
                <div className="admin-md__detail-head">
                  <div className="admin-roles__detail-head">
                    <div className="admin-roles__fields">
                      <div className="admin-md__field">
                        <Label htmlFor={roleNameInputId}>{t("roles.field.name")}</Label>
                        <Input
                          id={roleNameInputId}
                          value={selectedDraft.name}
                          onChange={(event) => updateDraftField(selectedRole.id, "name", event.currentTarget.value)}
                          disabled={!canEditSelectedRole}
                        />
                      </div>
                      <div className="admin-md__field">
                        <Label htmlFor={roleLevelInputId}>{t("roles.field.level")}</Label>
                        <Input
                          id={roleLevelInputId}
                          type="number"
                          value={selectedDraft.level}
                          min={1}
                          max={editableRoleLevelMax}
                          onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            if (!Number.isNaN(value)) {
                              updateDraftField(selectedRole.id, "level", Math.min(editableRoleLevelMax, Math.max(1, value)));
                            }
                          }}
                          disabled={!canEditSelectedRole}
                        />
                      </div>
                      <div className="admin-md__field">
                        <Label htmlFor={roleColorInputId}>{t("roles.field.color")}</Label>
                        <div className="admin-roles__color-control">
                          <Input
                            id={roleColorPickerId}
                            className="admin-roles__color-picker"
                            type="color"
                            aria-label={t("roles.field.colorPicker")}
                            value={colorPickerValue(selectedDraft.color)}
                            onChange={(event) => updateDraftField(selectedRole.id, "color", event.currentTarget.value)}
                            disabled={!canEditSelectedRole}
                          />
                          <Input
                            id={roleColorInputId}
                            value={selectedDraft.color}
                            onChange={(event) => updateDraftField(selectedRole.id, "color", event.currentTarget.value)}
                            disabled={!canEditSelectedRole}
                          />
                        </div>
                      </div>
                      <Badge className="admin-roles__assigned-count" variant="secondary">
                        {t("roles.assignedCount", { count: selectedRole.assigned_user_count })}
                      </Badge>
                    </div>
                    <div className="admin-md__detail-actions">
                      <Tooltip>
                        <TooltipTrigger
                          render={(
                            <Button
                              type="button"
                              className="admin-md__delete-action"
                              variant="destructive"
                              size="icon-lg"
                              onClick={() => { void handleDeleteRole(selectedRole); }}
                              loading={isRoleDeletePending(selectedRole.id)}
                              disabled={isRoleDeletePending(selectedRole.id) || !canDeleteSelectedRole}
                              aria-label={t("roles.delete")}
                            />
                          )}
                        >
                          <TrashIcon size={16} />
                        </TooltipTrigger>
                        <TooltipContent>{t("roles.delete")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={(
                            <Button
                              type="button"
                              size="icon-lg"
                              onClick={() => { void handleSaveRole(selectedRole, selectedDraft); }}
                              loading={updateRolePending}
                              disabled={!isDirty || !canEditSelectedRole}
                              aria-label={t("roles.save")}
                            />
                          )}
                        >
                          <SaveIcon size={16} />
                        </TooltipTrigger>
                        <TooltipContent>{t("roles.save")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>

                <ScrollArea className="admin-md__detail-body">
                  <div className="admin-md__detail-pad admin-roles__permissions">
                    {PERMISSION_CATEGORIES.map((category) => (
                      <section className="admin-roles__category" key={category.labelKey}>
                        <SectionHeader className="section-header--flush" title={t(category.labelKey)} />
                        <div className="admin-roles-perm-grid">
                          {category.permissions.map((permission) => {
                            const isGranted = Boolean(selectedDraft.permissions[permission]);
                            const meta = PERM_META[permission] ?? DEFAULT_META;
                            const label = t(`roles.permission.${permission}`, { defaultValue: permission });
                            const tooltipText = t(`roles.tooltip.${permission}`, { defaultValue: "" });
                            const toggle = (
                              <Button
                                key={`${selectedRole.id}-${permission}`}
                                type="button"
                                className={`admin-roles-perm ${isGranted ? "admin-roles-perm--granted" : ""}`}
                                aria-pressed={isGranted}
                                variant={isGranted ? "secondary" : "outline"}
                                onClick={() => togglePermission(selectedRole.id, permission)}
                                disabled={!canEditSelectedRole}
                                size="sm"
                              >
                                {isGranted ? (
                                  <CheckIcon data-icon="inline-start" size={14} className="admin-roles-perm-icon--granted" />
                                ) : (
                                  <XIcon data-icon="inline-start" size={14} className="admin-roles-perm-icon--denied" />
                                )}
                                {label}
                              </Button>
                            );

                            if (!tooltipText) return toggle;

                            return (
                              <Tooltip key={`${selectedRole.id}-${permission}`}>
                                <TooltipTrigger render={toggle} />
                                <TooltipContent className="admin-roles__permission-tooltip">
                                  <span className="admin-roles__permission-tooltip-icon" data-tone={meta.color}>
                                    {meta.icon}
                                  </span>
                                  <span className="admin-roles__permission-tooltip-copy">
                                    <span className="admin-roles__permission-tooltip-title">
                                      {label}
                                      {meta.danger ? (
                                        <Badge variant="destructive">
                                          <AlertTriangleIcon data-icon="inline-start" size={10} />
                                          {t("roles.tooltip.dangerBadge", { defaultValue: "Caution" })}
                                        </Badge>
                                      ) : null}
                                    </span>
                                    <span>{tooltipText}</span>
                                  </span>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="admin-md__empty">
                <span className="admin-md__muted">{t("roles.selectHint")}</span>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <Dialog open={createModalOpened} onOpenChange={setCreateModalOpened}>
        <DialogContent className="admin-roles__dialog" closeLabel={common("action.close")}>
          <DialogHeader>
            <DialogTitle>{t("roles.createTitle")}</DialogTitle>
            <DialogDescription>{t("roles.createDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="admin-roles__create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateRole();
            }}
          >
            <div className="admin-md__field">
              <Label htmlFor={createRoleNameInputId}>{t("roles.field.name")}</Label>
              <Input
                id={createRoleNameInputId}
                required
                autoFocus
                value={createRoleName}
                onChange={(event) => setCreateRoleName(event.currentTarget.value)}
                maxLength={80}
                aria-invalid={createRoleName.length > 0 && !createRoleNameValid}
                aria-describedby={`${createRoleNameInputId}-hint`}
              />
              <p className="admin-md__field-description" id={`${createRoleNameInputId}-hint`}>
                {t("roles.validation.nameRequired")}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateModalOpened(false)}>
                {t("roles.cancel")}
              </Button>
              <Button type="submit" loading={createRolePending} disabled={!createRoleNameValid}>
                {t("roles.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

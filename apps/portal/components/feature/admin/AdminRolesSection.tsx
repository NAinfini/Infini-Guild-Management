import { PERMISSIONS, type AdminRole, type Permission } from "@guild/shared";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import {
  ActionIcon,
  Alert,
  Badge,
  ColorInput,
  ColorSwatch,
  Group,
  HoverCard,
  NumberInput,
  Skeleton,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  BookTextIcon,
  CalendarDaysIcon,
  CheckIcon,
  EyeIcon,
  GalleryThumbnailsIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SettingsIcon,
  ShieldIcon,
  SwordsIcon,
  TrashIcon,
  UploadIcon,
  UserCheckIcon,
  XIcon,
} from "@portal/components/icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { userCanManageRoles } from "../../../utils/permissions";

type RoleDraft = {
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
  name?: string;
  level?: number;
  color?: string | null;
  permissions?: Record<Permission, boolean>;
};

type AdminRolesSectionProps = {
  rolesLoading: boolean;
  rolesError: boolean;
  roles: AdminRole[];
  createRolePending: boolean;
  updateRolePending: boolean;
  deleteRolePending: boolean;
  onCreateRole: (payload: RolePayload) => Promise<boolean>;
  onUpdateRole: (roleId: string, payload: RoleUpdatePayload) => Promise<boolean>;
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
    permissions: ["admin.status.view", "admin.roles.view", "admin.roles.manage"],
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

const PERM_META: Record<string, PermMeta> = {
  "admin.users.view":      { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "blue" },
  "admin.users.edit":      { icon: <PencilIcon size={PERM_ICON_SIZE} />,            color: "teal" },
  "admin.users.role":      { icon: <ShieldIcon size={PERM_ICON_SIZE} />,             color: "violet" },
  "admin.users.activate":  { icon: <UserCheckIcon size={PERM_ICON_SIZE} />,          color: "orange" },
  "admin.users.delete":    { icon: <TrashIcon size={PERM_ICON_SIZE} />,              color: "red", danger: true },
  "admin.users.password":  { icon: <LockIcon size={PERM_ICON_SIZE} />,               color: "orange", danger: true },
  "admin.invite.view":     { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "blue" },
  "admin.invite.manage":   { icon: <PlusIcon size={PERM_ICON_SIZE} />,               color: "teal" },
  "admin.audit.view":      { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "blue" },
  "admin.audit.export":    { icon: <ArchiveIcon size={PERM_ICON_SIZE} />,            color: "grape" },
  "admin.status.view":     { icon: <SettingsIcon size={PERM_ICON_SIZE} />,           color: "blue" },
  "admin.roles.view":      { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "blue" },
  "admin.roles.manage":    { icon: <ShieldIcon size={PERM_ICON_SIZE} />,             color: "red", danger: true },
  "admin.analytics.view":  { icon: <EyeIcon size={PERM_ICON_SIZE} />,              color: "blue" },
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
};

const DEFAULT_META: PermMeta = { icon: <SettingsIcon size={PERM_ICON_SIZE} />, color: "gray" };

function buildEmptyPermissions(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])) as Record<Permission, boolean>;
}

const CSS_COLOR_TO_HEX: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  gray: "#64748b",
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

function roleToDraft(role: AdminRole): RoleDraft {
  return {
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
  roles,
  createRolePending,
  updateRolePending,
  deleteRolePending,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
}: AdminRolesSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const user = useAuthStore((state) => state.user);
  const isAdmin = userCanManageRoles(user);
  const loadErrorMessage = tc("loadError");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});

  const emptyPermissions = useMemo(() => buildEmptyPermissions(), []);

  useEffect(() => {
    const next: Record<string, RoleDraft> = {};
    for (const role of roles) {
      next[role.id] = roleToDraft(role);
    }
    setDrafts(next);
    if (selectedRoleId === null && roles.length > 0 && roles[0]) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  if (!isAdmin) {
    return (
      <Stack gap={12}>
        <Alert color="yellow" title={t("adminOnly")} />
      </Stack>
    );
  }

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const selectedDraft = selectedRoleId ? drafts[selectedRoleId] : undefined;
  const isDirty = selectedRole && selectedDraft ? isRoleDraftDirty(selectedRole, selectedDraft) : false;

  const handleCreateRole = async () => {
    const name = `Role-${Math.random().toString(36).slice(2, 6)}`;

    await onCreateRole({
      name,
      level: 100,
      color: null,
      permissions: emptyPermissions,
    });
  };

  const handleDeleteRole = async (role: AdminRole) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("roles.confirmDeleteTitle"),
        children: t("roles.confirmDeleteDescription", { name: role.name }),
        confirmProps: { color: "red" },
        labels: {
          confirm: t("roles.delete"),
          cancel: t("roles.cancel"),
        },
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        closeOnCancel: true,
        closeOnConfirm: true,
        centered: true,
      });
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

  return (
    <Stack gap={12}>
      {rolesLoading ? <Stack gap={8}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {rolesError ? <Alert color="yellow" title={loadErrorMessage} /> : null}

      {!rolesLoading && !rolesError ? (
        <div className="admin-roles-layout">
          {/* ── Left panel: role list ── */}
          <div className="admin-roles-sidebar">
            <div className="admin-roles-sidebar-header">
              <Group gap={8} justify="space-between" wrap="nowrap">
                <Text fw={700} size="sm">{t("roles.listTitle")}</Text>
                <ActionIcon
                  size="sm"
                  variant="filled"
                  color="blue"
                  onClick={() => { void handleCreateRole(); }}
                  loading={createRolePending}
                  aria-label={t("roles.create")}
                >
                  <PlusIcon size={14} />
                </ActionIcon>
              </Group>
            </div>

            <ScrollArea className="admin-roles-sidebar-scroll" type="auto" scrollbarSize={6} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <Stack gap={4} p={8}>
                {roles.map((role) => {
                  const isSelected = role.id === selectedRoleId;
                  const roleDraft = drafts[role.id];
                  const dirty = roleDraft ? isRoleDraftDirty(role, roleDraft) : false;

                  return (
                    <UnstyledButton
                      key={role.id}
                      className={`admin-roles-sidebar-item ${isSelected ? "admin-roles-sidebar-item--active" : ""}`}
                      onClick={() => setSelectedRoleId(role.id)}
                    >
                      <Group gap={8} wrap="nowrap" justify="space-between">
                        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                          {role.color ? (
                            <ColorSwatch color={normalizeColor(role.color)} size={14} />
                          ) : (
                            <ColorSwatch color="transparent" size={14} />
                          )}
                          <Text size="sm" fw={isSelected ? 700 : 500} truncate>
                            {t(`role.${role.id}`, { defaultValue: role.name })}
                          </Text>
                        </Group>
                        <Group gap={4} wrap="nowrap">
                          {dirty ? (
                            <Badge size="xs" variant="light" color="yellow">*</Badge>
                          ) : null}
                          {role.is_builtin ? (
                            <Badge size="xs" variant="light" color="blue">{t("roles.builtin")}</Badge>
                          ) : (
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="red"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteRole(role);
                              }}
                              loading={deleteRolePending}
                              aria-label={t("roles.delete")}
                            >
                              <XIcon size={12} />
                            </ActionIcon>
                          )}
                        </Group>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </ScrollArea>
          </div>

          {/* ── Right panel: permissions ── */}
          <div className="admin-roles-detail">
            {selectedRole && selectedDraft ? (
              <Stack gap={16}>
                {/* Role header */}
                <div className="admin-roles-detail-header">
                  <Group justify="space-between" align="flex-end" wrap="wrap">
                    <Group gap={10} align="flex-end" wrap="wrap" style={{ minWidth: 0, flex: 1 }}>
                      <TextInput
                        size="sm"
                        label={t("roles.field.name")}
                        value={selectedRole.is_builtin ? t(`role.${selectedRole.id}`, { defaultValue: selectedDraft.name }) : selectedDraft.name}
                        onChange={(event) => updateDraftField(selectedRole.id, "name", event.currentTarget.value)}
                        style={{ flex: 1, minWidth: 100, maxWidth: 200 }}
                        disabled={selectedRole.is_builtin}
                      />
                      <NumberInput
                        size="sm"
                        label={t("roles.field.level")}
                        value={selectedDraft.level}
                        onChange={(value) => updateDraftField(selectedRole.id, "level", typeof value === "number" ? value : selectedDraft.level)}
                        min={1}
                        max={998}
                        hideControls
                        style={{ width: 80 }}
                        disabled={selectedRole.is_builtin}
                      />
                      <ColorInput
                        size="sm"
                        format="hex"
                        label={t("roles.field.color")}
                        value={selectedDraft.color}
                        onChange={(value) => updateDraftField(selectedRole.id, "color", value)}
                        style={{ flex: 1, minWidth: 120, maxWidth: 160 }}
                        swatches={[
                          "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
                          "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b",
                        ]}
                      />
                      <Badge variant="light" color="teal" size="sm">
                        {t("roles.assignedCount", { count: selectedRole.assigned_user_count })}
                      </Badge>
                    </Group>
                    <Group gap={8}>
                      {!selectedRole.is_builtin ? (
                        <ActionIcon
                          color="red"
                          variant="default"
                          size="lg"
                          onClick={() => { void handleDeleteRole(selectedRole); }}
                          loading={deleteRolePending}
                          aria-label={t("roles.delete")}
                        >
                          <TrashIcon size={16} />
                        </ActionIcon>
                      ) : null}
                      <ActionIcon
                        color="blue"
                        variant="filled"
                        size="lg"
                        onClick={() => {
                          void onUpdateRole(selectedRole.id, {
                            name: selectedDraft.name.trim(),
                            level: selectedDraft.level,
                            color: selectedDraft.color.trim() || null,
                            permissions: selectedDraft.permissions,
                          });
                        }}
                        loading={updateRolePending}
                        disabled={!isDirty}
                        aria-label={t("roles.save")}
                      >
                        <SaveIcon size={16} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </div>

                {/* Permission categories */}
                <ScrollArea type="auto" scrollbarSize={6} style={{ flex: 1 }}>
                  <Stack gap={20}>
                    {PERMISSION_CATEGORIES.map((category) => (
                      <div key={category.labelKey} className="admin-roles-perm-category">
                        <Text fw={700} size="sm" mb={8} c="dimmed" tt="uppercase" lts={0.5}>
                          {t(category.labelKey)}
                        </Text>
                        <div className="admin-roles-perm-grid">
                          {category.permissions.map((permission) => {
                            const isReadOnly = selectedRole.is_builtin;
                            const isGranted = Boolean(selectedDraft.permissions[permission]);
                            const meta = PERM_META[permission] ?? DEFAULT_META;
                            const tooltipText = t(`roles.tooltip.${permission}`, { defaultValue: "" });

                            const toggle = (
                              <DepthToggle
                                key={`${selectedRole.id}-${permission}`}
                                pressed={isGranted}
                                onToggle={() => {
                                  if (!isReadOnly) {
                                    togglePermission(selectedRole.id, permission);
                                  }
                                }}
                                type="secondary"
                                size="sm"
                                disabled={isReadOnly}
                                before={
                                  isGranted ? (
                                    <CheckIcon size={14} style={{ color: "#22c55e" }} />
                                  ) : (
                                    <XIcon size={14} style={{ color: "#ef4444" }} />
                                  )
                                }
                              >
                                {t(`roles.permission.${permission}`, { defaultValue: permission })}
                              </DepthToggle>
                            );

                            if (!tooltipText) return toggle;

                            return (
                              <HoverCard
                                key={`${selectedRole.id}-${permission}`}
                                width={320}
                                shadow="lg"
                                withArrow
                                arrowSize={10}
                                openDelay={350}
                                closeDelay={80}
                                position="top"
                              >
                                <HoverCard.Target>{toggle}</HoverCard.Target>
                                <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                                  <Group gap={10} wrap="nowrap" align="flex-start">
                                    <ThemeIcon
                                      variant="light"
                                      color={meta.color}
                                      size="lg"
                                      radius="md"
                                      style={{ flexShrink: 0, marginTop: 2 }}
                                    >
                                      {meta.icon}
                                    </ThemeIcon>
                                    <div style={{ minWidth: 0 }}>
                                      <Group gap={6} mb={4}>
                                        <Text size="sm" fw={700} lh={1.3}>
                                          {t(`roles.permission.${permission}`, { defaultValue: permission })}
                                        </Text>
                                        {meta.danger ? (
                                          <Badge
                                            size="xs"
                                            color="red"
                                            variant="light"
                                            leftSection={<AlertTriangleIcon size={10} />}
                                          >
                                            {t("roles.tooltip.dangerBadge", { defaultValue: "Caution" })}
                                          </Badge>
                                        ) : null}
                                      </Group>
                                      <Text size="xs" c="dimmed" lh={1.5}>
                                        {tooltipText}
                                      </Text>
                                    </div>
                                  </Group>
                                </HoverCard.Dropdown>
                              </HoverCard>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </Stack>
                </ScrollArea>
              </Stack>
            ) : (
              <div className="admin-roles-detail-empty">
                <Text c="dimmed">{t("roles.selectHint")}</Text>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Stack>
  );
}

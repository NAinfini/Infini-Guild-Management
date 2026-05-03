import { PERMISSIONS, type AdminRole, type Permission } from "@guild/shared";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import {
  ActionIcon,
  Alert,
  Badge,
  ColorInput,
  ColorSwatch,
  Group,
  Skeleton,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconCheck, IconDeviceFloppy, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
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
    permissions: ["announcements.create", "announcements.edit", "announcements.archive"],
  },
  {
    labelKey: "roles.category.gallery",
    permissions: ["gallery.upload", "gallery.manage"],
  },
  {
    labelKey: "roles.category.wiki",
    permissions: ["wiki.articles.create", "wiki.articles.edit", "wiki.articles.archive", "wiki.categories.manage"],
  },
];

function buildEmptyPermissions(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])) as Record<Permission, boolean>;
}

function roleToDraft(role: AdminRole): RoleDraft {
  return {
    name: role.name,
    level: role.level,
    color: role.color ?? "",
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

  if (draft.color.trim() !== (role.color ?? "")) {
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
  const heading = <Title order={3} style={{ margin: 0, fontSize: 16 }}>{t("tab.roles")}</Title>;
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
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
        {heading}
        <Alert color="yellow" title={t("adminOnly")} />
      </Stack>
    );
  }

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const selectedDraft = selectedRoleId ? drafts[selectedRoleId] : undefined;
  const isDirty = selectedRole && selectedDraft ? isRoleDraftDirty(selectedRole, selectedDraft) : false;

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    if (!name) {
      return;
    }

    const created = await onCreateRole({
      name,
      level: 2,
      color: null,
      permissions: emptyPermissions,
    });

    if (!created) {
      return;
    }

    setNewRoleName("");
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
      {heading}
      {rolesLoading ? <Stack gap={8}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {rolesError ? <Alert color="yellow" title={loadErrorMessage} /> : null}

      {!rolesLoading && !rolesError ? (
        <div className="admin-roles-layout">
          {/* ── Left panel: role list ── */}
          <div className="admin-roles-sidebar">
            <div className="admin-roles-sidebar-header">
              <Text fw={700} size="sm">{t("roles.listTitle")}</Text>
            </div>

            <ScrollArea className="admin-roles-sidebar-scroll" type="auto" scrollbarSize={6}>
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
                            <ColorSwatch color={role.color} size={14} />
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
                          ) : null}
                        </Group>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </ScrollArea>

            {/* Add new role */}
            <div className="admin-roles-sidebar-footer">
              <Group gap={6} wrap="nowrap">
                <TextInput
                  size="xs"
                  placeholder={t("roles.placeholder.name")}
                  value={newRoleName}
                  onChange={(event) => setNewRoleName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleCreateRole();
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  size="sm"
                  variant="filled"
                  color="blue"
                  onClick={() => { void handleCreateRole(); }}
                  loading={createRolePending}
                  disabled={!newRoleName.trim()}
                >
                  <IconPlus size={14} />
                </ActionIcon>
              </Group>
            </div>
          </div>

          {/* ── Right panel: permissions ── */}
          <div className="admin-roles-detail">
            {selectedRole && selectedDraft ? (
              <Stack gap={16}>
                {/* Role header */}
                <div className="admin-roles-detail-header">
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <Group gap={10} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
                      <TextInput
                        size="sm"
                        label={t("roles.field.name")}
                        value={selectedDraft.name}
                        onChange={(event) => updateDraftField(selectedRole.id, "name", event.currentTarget.value)}
                        style={{ flex: 1, minWidth: 120, maxWidth: 200 }}
                        disabled={selectedRole.is_builtin}
                      />
                      <ColorInput
                        size="sm"
                        label={t("roles.field.color")}
                        value={selectedDraft.color}
                        onChange={(value) => updateDraftField(selectedRole.id, "color", value)}
                        style={{ width: 160 }}
                        disabled={selectedRole.is_builtin}
                        swatches={[
                          "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
                          "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b",
                        ]}
                      />
                      <Group gap={6} mt={22}>
                        <Badge variant="light" color="teal" size="sm">
                          {t("roles.assignedCount", { count: selectedRole.assigned_user_count })}
                        </Badge>
                      </Group>
                    </Group>
                    <Group gap={8} mt={22}>
                      {!selectedRole.is_builtin ? (
                        <ActionIcon
                          color="red"
                          variant="default"
                          size="lg"
                          onClick={() => { void handleDeleteRole(selectedRole); }}
                          loading={deleteRolePending}
                          aria-label={t("roles.delete")}
                        >
                          <IconTrash size={16} />
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
                        <IconDeviceFloppy size={16} />
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
                            const isReadOnly = selectedRole.id === "admin";
                            const isGranted = Boolean(selectedDraft.permissions[permission]);

                            return (
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
                                    <IconCheck size={14} color="#22c55e" />
                                  ) : (
                                    <IconX size={14} color="#ef4444" />
                                  )
                                }
                              >
                                {t(`roles.permission.${permission}`, { defaultValue: permission })}
                              </DepthToggle>
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

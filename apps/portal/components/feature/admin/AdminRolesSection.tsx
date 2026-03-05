import { PERMISSIONS, type AdminRole, type Permission } from "@guild/shared";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  permissions?: Partial<Record<Permission, boolean>>;
};

type RoleUpdatePayload = {
  name?: string;
  level?: number;
  color?: string | null;
  permissions?: Partial<Record<Permission, boolean>>;
};

type AdminRolesSectionProps = {
  heading: ReactNode;
  isAdmin: boolean;
  adminOnlyMessage: string;
  rolesLoading: boolean;
  rolesError: boolean;
  loadErrorMessage: string;
  roles: AdminRole[];
  createRolePending: boolean;
  updateRolePending: boolean;
  deleteRolePending: boolean;
  onCreateRole: (payload: RolePayload) => Promise<boolean>;
  onUpdateRole: (roleId: string, payload: RoleUpdatePayload) => Promise<boolean>;
  onDeleteRole: (roleId: string) => Promise<boolean>;
};

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
  heading,
  isAdmin,
  adminOnlyMessage,
  rolesLoading,
  rolesError,
  loadErrorMessage,
  roles,
  createRolePending,
  updateRolePending,
  deleteRolePending,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
}: AdminRolesSectionProps) {
  const { t } = useTranslation("admin");
  const [newRoleId, setNewRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleLevel, setNewRoleLevel] = useState<number>(2);
  const [newRoleColor, setNewRoleColor] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});

  const emptyPermissions = useMemo(() => buildEmptyPermissions(), []);

  useEffect(() => {
    const next: Record<string, RoleDraft> = {};
    for (const role of roles) {
      next[role.id] = roleToDraft(role);
    }
    setDrafts(next);
  }, [roles]);

  if (!isAdmin) {
    return (
      <Stack gap={12}>
        {heading}
        <Alert color="infini-warning" title={adminOnlyMessage} />
      </Stack>
    );
  }

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    if (!name) {
      return;
    }

    const created = await onCreateRole({
      id: newRoleId.trim() || undefined,
      name,
      level: Math.max(1, Math.min(2, Math.round(newRoleLevel || 2))),
      color: newRoleColor.trim() || null,
      permissions: emptyPermissions,
    });

    if (!created) {
      return;
    }

    setNewRoleId("");
    setNewRoleName("");
    setNewRoleLevel(2);
    setNewRoleColor("");
  };

  const handleDeleteRole = async (role: AdminRole) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("roles.confirmDeleteTitle"),
        children: t("roles.confirmDeleteDescription", { name: role.name }),
        confirmProps: { color: "infini-danger" },
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

    await onDeleteRole(role.id);
  };

  return (
    <Stack gap={12}>
      {heading}
      {rolesLoading ? <Loader size="sm" /> : null}
      {rolesError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}

      {!rolesLoading && !rolesError ? (
        <>
          <div className="admin-roles-create-card">
            <Stack gap={10}>
              <Text fw={700}>{t("roles.createTitle")}</Text>
              <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing={10}>
                <TextInput
                  label={t("roles.field.id")}
                  placeholder={t("roles.placeholder.id")}
                  value={newRoleId}
                  onChange={(event) => setNewRoleId(event.currentTarget.value)}
                />
                <TextInput
                  label={t("roles.field.name")}
                  placeholder={t("roles.placeholder.name")}
                  value={newRoleName}
                  onChange={(event) => setNewRoleName(event.currentTarget.value)}
                />
                <NumberInput
                  label={t("roles.field.level")}
                  min={1}
                  max={2}
                  value={newRoleLevel}
                  onChange={(value) => setNewRoleLevel(typeof value === "number" ? value : 2)}
                />
                <TextInput
                  label={t("roles.field.color")}
                  placeholder={t("roles.placeholder.color")}
                  value={newRoleColor}
                  onChange={(event) => setNewRoleColor(event.currentTarget.value)}
                />
              </SimpleGrid>
              <Group justify="flex-end">
                <Button
                  leftSection={<IconPlus size={14} />}
                  onClick={() => {
                    void handleCreateRole();
                  }}
                  loading={createRolePending}
                  disabled={!newRoleName.trim()}
                >
                  {t("roles.create")}
                </Button>
              </Group>
            </Stack>
          </div>

          <Stack gap={10}>
            {roles.map((role) => {
              const draft = drafts[role.id] ?? roleToDraft(role);
              const isAdminRole = role.id === "admin";
              const canDelete = !role.is_builtin;
              const isDirty = isRoleDraftDirty(role, draft);

              return (
                <div key={role.id} className="admin-roles-role-card">
                  <Stack gap={10}>
                    <Group justify="space-between" align="center">
                      <Group gap={8}>
                        <Text fw={700}>{role.id}</Text>
                        <Badge variant="light" color={role.is_builtin ? "blue" : "gray"}>
                          {role.is_builtin ? t("roles.builtin") : t("roles.custom")}
                        </Badge>
                        <Badge variant="light" color="teal">
                          {t("roles.assignedCount", { count: role.assigned_user_count })}
                        </Badge>
                      </Group>
                      {canDelete ? (
                        <Button
                          color="infini-danger"
                          variant="light"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => {
                            void handleDeleteRole(role);
                          }}
                          loading={deleteRolePending}
                        >
                          {t("roles.delete")}
                        </Button>
                      ) : null}
                    </Group>

                    <SimpleGrid cols={{ base: 1, md: 3 }} spacing={10}>
                      <TextInput
                        label={t("roles.field.name")}
                        value={draft.name}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [role.id]: {
                              ...draft,
                              name: event.currentTarget.value,
                            },
                          }))
                        }
                      />
                      <NumberInput
                        label={t("roles.field.level")}
                        min={1}
                        max={role.is_builtin ? role.level : 2}
                        value={draft.level}
                        disabled={role.is_builtin}
                        onChange={(value) =>
                          setDrafts((current) => ({
                            ...current,
                            [role.id]: {
                              ...draft,
                              level: typeof value === "number" ? value : role.level,
                            },
                          }))
                        }
                      />
                      <TextInput
                        label={t("roles.field.color")}
                        placeholder={t("roles.placeholder.color")}
                        value={draft.color}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [role.id]: {
                              ...draft,
                              color: event.currentTarget.value,
                            },
                          }))
                        }
                      />
                    </SimpleGrid>

                    <Stack gap={8}>
                      <Text fw={600} size="sm">{t("roles.permissions")}</Text>
                      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing={6}>
                        {PERMISSIONS.map((permission) => (
                          <Switch
                            key={`${role.id}-${permission}`}
                            label={t(`roles.permission.${permission}`, { defaultValue: permission })}
                            checked={isAdminRole ? true : Boolean(draft.permissions[permission])}
                            disabled={isAdminRole}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [role.id]: {
                                  ...draft,
                                  permissions: {
                                    ...draft.permissions,
                                    [permission]: event.currentTarget.checked,
                                  },
                                },
                              }))
                            }
                          />
                        ))}
                      </SimpleGrid>
                    </Stack>

                    <Group justify="flex-end">
                      <Button
                        onClick={() => {
                          void onUpdateRole(role.id, {
                            name: draft.name.trim(),
                            level: draft.level,
                            color: draft.color.trim() || null,
                            permissions: draft.permissions,
                          });
                        }}
                        loading={updateRolePending}
                        disabled={!isDirty}
                      >
                        {t("roles.save")}
                      </Button>
                    </Group>
                  </Stack>
                </div>
              );
            })}
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}

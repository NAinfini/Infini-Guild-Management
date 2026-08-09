import { PERMISSIONS, type AdminRole, type Permission } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  ColorInput,
  ColorSwatch,
  Group,
  HoverCard,
  Modal,
  NumberInput,
  Skeleton,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  BookTextIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClipboardIcon,
  EyeIcon,
  GalleryThumbnailsIcon,
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
  isRoleDeletePending: (roleId: string) => boolean;
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
    permissions: [
      "admin.status.view",
      "admin.roles.view",
      "admin.roles.manage",
      "admin.siteConfig.manage",
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

const PERM_META: Record<string, PermMeta> = {
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

const CSS_COLOR_TO_HEX: Record<string, string> = {
  red: "#ef4444",
  blue: "#D4A843",
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
  isRoleDeletePending,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
}: AdminRolesSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const user = useAuthStore((state) => state.user);
  const isAdmin = userCanManageRoles(user);
  const loadErrorMessage = tc("loadError");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [createRoleName, setCreateRoleName] = useState("");

  const emptyPermissions = useMemo(() => buildEmptyPermissions(), []);
  const normalizedCreateRoleName = createRoleName.trim();
  const createRoleNameValid = normalizedCreateRoleName.length > 0 && normalizedCreateRoleName.length <= 80;

  useEffect(() => {
    const next: Record<string, RoleDraft> = {};
    for (const role of roles) {
      next[role.id] = roleToDraft(role);
    }
    setDrafts(next);
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
      <Stack gap={12}>
        <Alert color="red" title={t("adminOnly")} />
      </Stack>
    );
  }

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const selectedDraft = selectedRoleId ? drafts[selectedRoleId] : undefined;
  const isDirty = selectedRole && selectedDraft ? isRoleDraftDirty(selectedRole, selectedDraft) : false;

  const openCreateRoleModal = () => {
    setCreateRoleName("");
    setCreateModalOpened(true);
  };

  const handleCreateRole = async () => {
    if (!createRoleNameValid) return;

    const created = await onCreateRole({
      name: normalizedCreateRoleName,
      level: 100,
      color: null,
      permissions: emptyPermissions,
    });
    if (created) {
      setCreateModalOpened(false);
      setCreateRoleName("");
    }
  };

  const handleDeleteRole = async (role: AdminRole) => {
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

    await onUpdateRole(role.id, {
      name: draft.name.trim(),
      level: draft.level,
      color: draft.color.trim() || null,
      permissions: draft.permissions,
    });
  };

  return (
    /* admin-fill：把 .admin-page__panel 给的高度原样传给下面的主从台。 */
    <Stack gap={12} className="admin-fill">
      {rolesLoading ? <Stack gap={8}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {rolesError ? <Alert color="red" title={loadErrorMessage} /> : null}

      {!rolesLoading && !rolesError ? (
        <div className="admin-md">
          {/* ── Left panel: role list ── */}
          <div className="admin-md__master">
            <div className="admin-md__master-head">
              <Group gap={8} justify="space-between" wrap="nowrap">
                <Text fw={700} size="sm">{t("roles.listTitle")}</Text>
                <ActionIcon
                  size="sm"
                  variant="filled"
                  color="portal-brand"
                  onClick={openCreateRoleModal}
                  loading={createRolePending}
                  aria-label={t("roles.create")}
                >
                  <PlusIcon size={14} />
                </ActionIcon>
              </Group>
            </div>

            <ScrollArea className="admin-md__list" type="auto" scrollbarSize={6}>
              <Stack gap={2} p={6}>
                {roles.map((role) => {
                  const isSelected = role.id === selectedRoleId;
                  const roleDraft = drafts[role.id];
                  const dirty = roleDraft ? isRoleDraftDirty(role, roleDraft) : false;

                  return (
                    <UnstyledButton
                      key={role.id}
                      className={`admin-md__item ${isSelected ? "admin-md__item--active" : ""}`}
                      onClick={() => setSelectedRoleId(role.id)}
                    >
                      {/*
                        * 左右分组由 .admin-md__item-main / __item-meta 承担：名字那一组让位，
                        * 状态那一组不收缩。两边都可收缩时，浏览器会按基准宽度成比例压缩，
                        * 「*」这种一个字符的徽标会被压到零宽——DOM 里在，量出来是隐藏。
                        */}
                      <span className="admin-md__item-main">
                        {role.color ? (
                          <ColorSwatch color={normalizeColor(role.color)} size={14} />
                        ) : (
                          <ColorSwatch color="transparent" size={14} />
                        )}
                        <Text size="sm" fw={isSelected ? 700 : 500} truncate>
                          {role.name}
                        </Text>
                      </span>
                      <span className="admin-md__item-meta">
                        {dirty ? (
                          <Badge size="xs" variant="light" color="orange">*</Badge>
                        ) : null}
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteRole(role);
                          }}
                          loading={isRoleDeletePending(role.id)}
                          disabled={isRoleDeletePending(role.id)}
                          aria-label={t("roles.delete")}
                        >
                          <XIcon size={12} />
                        </ActionIcon>
                      </span>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </ScrollArea>
          </div>

          {/* ── Right panel: permissions ── */}
          <div className="admin-md__detail">
            {selectedRole && selectedDraft ? (
              <>
                {/* Role header */}
                <div className="admin-md__detail-head">
                  <Group justify="space-between" align="flex-end" wrap="wrap">
                    <Group gap={10} align="flex-end" wrap="wrap" style={{ minWidth: 0, flex: 1 }}>
                      <TextInput
                        size="sm"
                        label={t("roles.field.name")}
                        value={selectedDraft.name}
                        onChange={(event) => updateDraftField(selectedRole.id, "name", event.currentTarget.value)}
                        style={{ flex: 1, minWidth: 100, maxWidth: 200 }}
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
                      />
                      <ColorInput
                        size="sm"
                        format="hex"
                        label={t("roles.field.color")}
                        eyeDropperButtonProps={{ "aria-label": t("roles.field.colorPicker") }}
                        value={selectedDraft.color}
                        onChange={(value) => updateDraftField(selectedRole.id, "color", value)}
                        style={{ flex: 1, minWidth: 120, maxWidth: 160 }}
                        swatches={[
                          "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
                          "#D4A843", "#6366f1", "#a855f7", "#ec4899", "#64748b",
                        ]}
                      />
                      <Badge variant="light" color="teal" size="sm">
                        {t("roles.assignedCount", { count: selectedRole.assigned_user_count })}
                      </Badge>
                    </Group>
                    <Group gap={8}>
                      <ActionIcon
                        color="red"
                        variant="default"
                        size="lg"
                        onClick={() => { void handleDeleteRole(selectedRole); }}
                        loading={isRoleDeletePending(selectedRole.id)}
                        disabled={isRoleDeletePending(selectedRole.id)}
                        aria-label={t("roles.delete")}
                      >
                        <TrashIcon size={16} />
                      </ActionIcon>
                      <ActionIcon
                        color="portal-brand"
                        variant="filled"
                        size="lg"
                        onClick={() => { void handleSaveRole(selectedRole, selectedDraft); }}
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
                <ScrollArea className="admin-md__detail-body" type="auto" scrollbarSize={6}>
                  <Stack gap={20} className="admin-md__detail-pad">
                    {PERMISSION_CATEGORIES.map((category) => (
                      <div key={category.labelKey}>
                        <SectionHeader title={t(category.labelKey)} />
                        <div className="admin-roles-perm-grid">
                          {category.permissions.map((permission) => {
                            const isGranted = Boolean(selectedDraft.permissions[permission]);
                            const meta = PERM_META[permission] ?? DEFAULT_META;
                            const tooltipText = t(`roles.tooltip.${permission}`, { defaultValue: "" });

                            const toggle = (
                              <Button
                                key={`${selectedRole.id}-${permission}`}
                                aria-pressed={isGranted}
                                variant={isGranted ? "light" : "default"}
                                color={isGranted ? "portal-brand" : "gray"}
                                onClick={() => togglePermission(selectedRole.id, permission)}
                                size="sm"
                                leftSection={
                                  isGranted ? (
                                    <CheckIcon size={14} className="admin-roles-perm-icon--granted" />
                                  ) : (
                                    <XIcon size={14} className="admin-roles-perm-icon--denied" />
                                  )
                                }
                              >
                                {t(`roles.permission.${permission}`, { defaultValue: permission })}
                              </Button>
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
              </>
            ) : (
              <div className="admin-md__empty">
                <Text c="dimmed">{t("roles.selectHint")}</Text>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <Modal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        title={t("roles.createTitle")}
        centered
        returnFocus
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateRole();
          }}
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">{t("roles.createDescription")}</Text>
            <TextInput
              required
              data-autofocus
              label={t("roles.field.name")}
              description={t("roles.validation.nameRequired")}
              value={createRoleName}
              onChange={(event) => setCreateRoleName(event.currentTarget.value)}
              maxLength={80}
              error={createRoleName.length > 0 && !createRoleNameValid
                ? t("roles.validation.nameRequired")
                : undefined}
            />
            <Group justify="flex-end">
              <Button
                type="button"
                variant="default"
                onClick={() => setCreateModalOpened(false)}
              >
                {t("roles.cancel")}
              </Button>
              <Button
                type="submit"
                loading={createRolePending}
                disabled={!createRoleNameValid}
              >
                {t("roles.create")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

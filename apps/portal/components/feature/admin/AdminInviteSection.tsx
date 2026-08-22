import type { AdminRole, InviteLink } from "@guild/shared";
import { ActionIcon, Badge, Button, ColorSwatch, Group, HoverCard, Loader, Menu, Modal, NumberInput, Paper, SegmentedControl, Select, Skeleton, Stack, Text, TextInput, ThemeIcon, Tooltip } from "@mantine/core";
import { AlertTriangleIcon, BanIcon, CircleCheckIcon, CircleXIcon, CopyIcon, DotsIcon, InfoCircleIcon, PlusIcon, SearchIcon, TrashIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { useCallback, useMemo, useState } from "react";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useEffectivePermissions } from "../../../hooks/useEffectivePermissions";
import { formatDateTime } from "../../../utils/datetime";
import { copyPlainText } from "../../../utils/copy";
import { resolveInviteStatus, type InviteStatus } from "../../../utils/invite-status";
import type { InviteLinkStatsSummary } from "../../../services/AdminService";
import { AdminLoadError } from "./AdminLoadError";

type InviteRow = InviteLink;
type InviteStats = InviteLinkStatsSummary;

function InviteRole({ invite }: { invite: InviteRow }) {
  return (
    <Group gap={6} wrap="nowrap">
      <ColorSwatch color={invite.role_color ?? "var(--mantine-color-gray-5)"} size={12} />
      <Text size="sm" truncate>{invite.role_name}</Text>
    </Group>
  );
}

const INVITE_STATUS_PRESENTATION = {
  revoked: { color: "red", Icon: AlertTriangleIcon },
  fullyUsed: { color: "orange", Icon: CircleXIcon },
  expired: { color: "orange", Icon: InfoCircleIcon },
  active: { color: "green", Icon: CircleCheckIcon },
} as const satisfies Record<InviteStatus, {
  color: string;
  Icon: typeof AlertTriangleIcon;
}>;

function InviteStatusBadge({ invite }: { invite: InviteRow }) {
  const { t } = useTranslation("admin");
  const status = resolveInviteStatus(invite);
  const { color, Icon } = INVITE_STATUS_PRESENTATION[status];
  const label = t(`invite.status.${status}`);

  return (
    <HoverCard width={260} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
      <HoverCard.Target>
        <Badge data-animate-icon-trigger color={color} variant="light">{label}</Badge>
      </HoverCard.Target>
      <HoverCard.Dropdown p="sm" className="admin-invite-status-popover">
        <Group gap={10} wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color={color} size="lg" radius="md" className="admin-invite-status-icon">
            <Icon size={16} />
          </ThemeIcon>
          <div className="admin-invite-status-copy">
            <Text size="sm" fw={700} lh={1.3} mb={4}>{label}</Text>
            <Text size="xs" c="dimmed" lh={1.5}>{t(`invite.tooltip.${status}`)}</Text>
          </div>
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

type AdminInviteSectionProps = {
  inviteVisibility: "active" | "expired" | "revoked";
  onInviteVisibilityChange: (value: "active" | "expired" | "revoked") => void;
  onCreateInvite: (
    input: { roleId: string; maxUses: number; expiresAt: string },
    onSuccess: () => void,
  ) => void;
  roles: AdminRole[];
  createInvitePending: boolean;
  inviteStatsLoading: boolean;
  inviteStats: InviteStats | null;
  inviteLinksLoading: boolean;
  inviteLinksError: boolean;
  onRetryInviteLinks: () => void;
  inviteRows: InviteRow[];
  inviteTotal: number;
  hasMoreInvites: boolean;
  loadingMoreInvites: boolean;
  onLoadMoreInvites: () => void;
  inviteSearch: string;
  onInviteSearchChange: (value: string) => void;
  isInviteInactive: (row: InviteRow) => boolean;
  isInviteActionPending: (inviteId: string, action: "revoke" | "delete") => boolean;
  onRevokeInvite: (inviteId: string) => void;
  onDeleteInvite: (inviteId: string) => void;
};

export function AdminInviteSection({
  inviteVisibility,
  onInviteVisibilityChange,
  onCreateInvite,
  roles,
  createInvitePending,
  inviteStatsLoading,
  inviteStats,
  inviteLinksLoading,
  inviteLinksError,
  onRetryInviteLinks,
  inviteRows,
  inviteTotal,
  hasMoreInvites,
  loadingMoreInvites,
  onLoadMoreInvites,
  inviteSearch,
  onInviteSearchChange,
  isInviteInactive,
  isInviteActionPending,
  onRevokeInvite,
  onDeleteInvite,
}: AdminInviteSectionProps) {
  const { t } = useTranslation("admin");
  const confirm = useConfirmDialog();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isAdmin = canManagePermission(["admin.invite.manage"]);
  const [createModalOpen, createModalHandlers] = useDisclosure(false);
  const isCompactLayout = useMediaQuery("(max-width: 64em)");
  const [inviteMaxUses, setInviteMaxUses] = useState(10);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState<string | null>(null);

  const resetCreateForm = useCallback(() => {
    setInviteMaxUses(10);
    setInviteExpiresAt("");
    setInviteRoleId(null);
  }, []);
  const handleOpenCreateModal = useCallback(() => {
    resetCreateForm();
    createModalHandlers.open();
  }, [createModalHandlers, resetCreateForm]);
  const handleCloseCreateModal = useCallback(() => {
    createModalHandlers.close();
    resetCreateForm();
  }, [createModalHandlers, resetCreateForm]);
  const handleCreateInvite = useCallback(() => {
    if (!inviteRoleId) {
      return;
    }
    onCreateInvite(
      { roleId: inviteRoleId, maxUses: inviteMaxUses, expiresAt: inviteExpiresAt },
      handleCloseCreateModal,
    );
  }, [handleCloseCreateModal, inviteExpiresAt, inviteMaxUses, inviteRoleId, onCreateInvite]);

  const handleCopyInviteLink = useCallback((row: InviteRow) => {
    void copyPlainText(`${window.location.origin}/register/${row.code}`);
  }, []);

  const handleRevokeInvite = useCallback((row: InviteRow) => {
    if (isInviteActionPending(row.id, "revoke") || isInviteActionPending(row.id, "delete")) {
      return;
    }
    void (async () => {
      const confirmed = await confirm({
        title: t("confirm.revokeInvite.title"),
        description: t("confirm.revokeInvite.description", { code: row.code }),
        confirmLabel: t("invite.revoke"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) {
        return;
      }
      onRevokeInvite(row.id);
    })();
  }, [confirm, isInviteActionPending, onRevokeInvite, t]);

  const handleDeleteInvite = useCallback((row: InviteRow) => {
    if (isInviteActionPending(row.id, "revoke") || isInviteActionPending(row.id, "delete")) {
      return;
    }
    void (async () => {
      const confirmed = await confirm({
        title: t("confirm.deleteInvite.title"),
        description: t("confirm.deleteInvite.description", { code: row.code }),
        confirmLabel: t("common:action.delete"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) {
        return;
      }
      onDeleteInvite(row.id);
    })();
  }, [confirm, isInviteActionPending, onDeleteInvite, t]);

  const columns = useMemo<ColumnDef<InviteRow, unknown>[]>(() => {
    const cols: ColumnDef<InviteRow, unknown>[] = [];

    if (isAdmin) {
      cols.push({
        header: t("invite.table.code"),
        id: "code",
        accessorKey: "code",
      });
    }

    cols.push({
      header: t("invite.table.role"),
      id: "role",
      accessorFn: (row) => row.role_name,
      cell: ({ row }) => <InviteRole invite={row.original} />,
    });

    cols.push({
      header: t("invite.table.usage"),
      id: "usage",
      accessorFn: (row) => row.used_count / Math.max(row.max_uses, 1),
      /* 「还剩几次能用」是这张表最该一眼看懂的东西，光给个分数看不出程度。 */
      cell: ({ row }) => {
        const used = row.original.used_count;
        const max = row.original.max_uses;
        const ratio = max > 0 ? Math.min(100, (used / max) * 100) : 0;
        return (
          <span className="admin-invite-usage">
            <span className="admin-invite-usage__track">
              <span
                className={`admin-invite-usage__fill${ratio >= 100 ? " admin-invite-usage__fill--full" : ""}`}
                style={{ width: `${ratio}%` }}
              />
            </span>
            <span className="admin-invite-usage__value">{used}/{max}</span>
          </span>
        );
      },
    });

    cols.push({
      header: t("invite.table.status"),
      id: "status",
      enableSorting: false,
      cell: ({ row }) => <InviteStatusBadge invite={row.original} />,
    });

    cols.push(
      {
        header: t("invite.table.expires"),
        id: "expires",
        accessorFn: (row) => row.expires_at ?? "",
        cell: ({ row }) => formatDateTime(row.original.expires_at),
      },
      {
        header: t("invite.table.created"),
        id: "created",
        accessorFn: (row) => row.created_at ?? "",
        cell: ({ row }) => formatDateTime(row.original.created_at),
      },
    );

    if (isAdmin) {
      cols.push({
        header: t("invite.table.actions"),
        id: "actions",
        enableSorting: false,
        cell: ({ row }) => {
          const inactive = isInviteInactive(row.original);
          const revokePending = isInviteActionPending(row.original.id, "revoke");
          const deletePending = isInviteActionPending(row.original.id, "delete");
          const destructivePending = revokePending || deletePending;
          const inactiveReason = t(`invite.tooltip.${resolveInviteStatus(row.original)}`);
          // Keep the frequent copy action visible; destructive actions stay in the row menu.
          return (
            <Group gap={6} wrap="nowrap">
              <Tooltip label={inactiveReason} withArrow disabled={!inactive}>
                <span data-disabled-tooltip-target={inactive || undefined}>
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<CopyIcon size={14} />}
                    onClick={() => handleCopyInviteLink(row.original)}
                    disabled={inactive}
                  >
                    {t("invite.copy")}
                  </Button>
                </span>
              </Tooltip>
              <Menu withinPortal position="bottom-end" shadow="md" width={180}>
                <Menu.Target>
                  <ActionIcon variant="subtle" size="sm" aria-label={t("invite.table.actions")}>
                    <DotsIcon size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {/* 收进菜单之后同样要说清「为什么点不了」，不能只把它置灰。 */}
                  <Tooltip label={inactiveReason} withArrow position="left" disabled={!inactive}>
                    <span data-disabled-tooltip-target={inactive || undefined}>
                      <Menu.Item
                        leftSection={revokePending ? <Loader size={14} /> : <BanIcon size={14} />}
                        disabled={inactive || destructivePending}
                        onClick={() => handleRevokeInvite(row.original)}
                      >
                        {t("invite.revoke")}
                      </Menu.Item>
                    </span>
                  </Tooltip>
                  <Menu.Item
                    color="red"
                    leftSection={deletePending ? <Loader size={14} /> : <TrashIcon size={14} />}
                    disabled={destructivePending}
                    onClick={() => handleDeleteInvite(row.original)}
                  >
                    {t("invite.delete")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          );
        },
      });
    }

    return cols;
   
  }, [
    handleCopyInviteLink,
    handleDeleteInvite,
    handleRevokeInvite,
    isAdmin,
    isInviteActionPending,
    isInviteInactive,
    t,
  ]);

  const table = useReactTable({
    data: inviteRows,
    columns,
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const inviteCountControls = (
    <Group justify="space-between" align="center">
      <Text size="sm" c="dimmed">
        {t("invite.loadedCount", {
          loaded: inviteRows.length,
          total: inviteTotal,
        })}
      </Text>
      {hasMoreInvites ? (
        <Button
          size="sm"
          variant="default"
          loading={loadingMoreInvites}
          disabled={loadingMoreInvites}
          onClick={onLoadMoreInvites}
        >
          {t("invite.loadMore")}
        </Button>
      ) : null}
    </Group>
  );

  return (
    /* admin-fill：把 .admin-page__panel 给的高度原样传给下面的表格卡片。 */
    <Stack gap={12} className="admin-fill">
      {/* 工具条语序和成员页一致：搜索（伸展）→ 筛选 → ——— → 主操作。 */}
      <div className="admin-toolbar">
        <TextInput
          className="admin-toolbar__search"
          size="sm"
          leftSection={<SearchIcon size={14} />}
          placeholder={t(isAdmin ? "invite.search" : "invite.searchDateOnly")}
          value={inviteSearch}
          onChange={(event) => onInviteSearchChange(event.currentTarget.value)}
        />
        <SegmentedControl
          size="xs"
          value={inviteVisibility}
          onChange={(value) => onInviteVisibilityChange(value as "active" | "expired" | "revoked")}
          data={[
            { value: "active", label: t("invite.segActive") },
            { value: "expired", label: t("invite.segExpired") },
            { value: "revoked", label: t("invite.segRevoked") },
          ]}
        />
        {inviteStatsLoading ? <Loader size="xs" /> : null}
        <div className="admin-toolbar__spacer" />
        {isAdmin ? (
          <Button size="sm" leftSection={<PlusIcon size={16} />} onClick={handleOpenCreateModal}>
            {t("invite.create")}
          </Button>
        ) : null}
      </div>

      {inviteStats ? (
        <div className="admin-panel admin-stats">
          <div className="admin-stat">
            <div className="admin-stat__value">{inviteStats.total}</div>
            <div className="admin-stat__label">{t("invite.stats.total")}</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat__value admin-stat__value--ok">{inviteStats.active}</div>
            <div className="admin-stat__label">{t("invite.stats.active")}</div>
          </div>
          <div className="admin-stat">
            <div className={`admin-stat__value${inviteStats.expired > 0 ? " admin-stat__value--warn" : ""}`}>
              {inviteStats.expired}
            </div>
            <div className="admin-stat__label">{t("invite.stats.expired")}</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat__value">{inviteStats.revoked}</div>
            <div className="admin-stat__label">{t("invite.stats.revoked")}</div>
          </div>
        </div>
      ) : null}

      {/* Table */}
      {inviteLinksLoading ? <Stack gap={8}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {inviteLinksError ? <AdminLoadError onRetry={onRetryInviteLinks} /> : null}
      {!inviteLinksLoading && !inviteLinksError ? (
        isCompactLayout ? (
          <Stack gap="md">
            <div className="admin-invite-card-list">
              {inviteRows.map((row) => {
                const inactive = isInviteInactive(row);
                const revokePending = isInviteActionPending(row.id, "revoke");
                const deletePending = isInviteActionPending(row.id, "delete");
                const destructivePending = revokePending || deletePending;
                const inactiveReason = t(`invite.tooltip.${resolveInviteStatus(row)}`);
                return (
                  <Paper
                    component="article"
                    key={row.id}
                    withBorder
                    radius="md"
                    aria-label={t("invite.cardAria")}
                  >
                    <div className="admin-invite-card-content">
                      <Stack gap="md">
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                          {isAdmin ? (
                            <div className="admin-invite-card__code-block">
                              <Text size="xs" c="dimmed">{t("invite.table.code")}</Text>
                              <Text component="code" className="admin-invite-card__code">
                                {row.code}
                              </Text>
                            </div>
                          ) : null}
                          <InviteStatusBadge invite={row} />
                        </Group>

                        <dl className="admin-invite-card__details">
                          <div>
                            <dt>{t("invite.table.role")}</dt>
                            <dd><InviteRole invite={row} /></dd>
                          </div>
                          <div>
                            <dt>{t("invite.table.usage")}</dt>
                            <dd>{row.used_count}/{row.max_uses}</dd>
                          </div>
                          <div>
                            <dt>{t("invite.table.expires")}</dt>
                            <dd>
                              {row.expires_at ? (
                                <time dateTime={row.expires_at}>{formatDateTime(row.expires_at)}</time>
                              ) : formatDateTime(null)}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("invite.table.created")}</dt>
                            <dd><time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time></dd>
                          </div>
                        </dl>

                        {isAdmin ? (
                          <div className="admin-invite-card__actions">
                            <Tooltip label={inactiveReason} withArrow disabled={!inactive}>
                              <span data-disabled-tooltip-target={inactive || undefined}>
                                <Button
                                  fullWidth
                                  size="md"
                                  variant="light"
                                  leftSection={<CopyIcon size={16} />}
                                  onClick={() => handleCopyInviteLink(row)}
                                  disabled={inactive}
                                >
                                  {t("invite.copy")}
                                </Button>
                              </span>
                            </Tooltip>
                            <Tooltip label={inactive ? inactiveReason : t("invite.revoke")} withArrow>
                              <span data-disabled-tooltip-target={inactive || undefined}>
                                <Button
                                  fullWidth
                                  size="md"
                                  color="orange"
                                  variant="light"
                                  leftSection={<BanIcon size={16} />}
                                  loading={revokePending}
                                  disabled={inactive || destructivePending}
                                  onClick={() => handleRevokeInvite(row)}
                                >
                                  {t("invite.revoke")}
                                </Button>
                              </span>
                            </Tooltip>
                            <Tooltip label={t("invite.delete")} withArrow>
                              <span>
                                <Button
                                  fullWidth
                                  size="md"
                                  color="red"
                                  variant="light"
                                  leftSection={<TrashIcon size={16} />}
                                  loading={deletePending}
                                  disabled={destructivePending}
                                  onClick={() => handleDeleteInvite(row)}
                                >
                                  {t("invite.delete")}
                                </Button>
                              </span>
                            </Tooltip>
                          </div>
                        ) : null}
                      </Stack>
                    </div>
                  </Paper>
                );
              })}
            </div>
            {inviteCountControls}
          </Stack>
        ) : (
          <Paper withBorder radius="md" className="admin-table-card admin-table-card--fill">
            <div className="admin-table-card__scroll">
              <DataTableAdapter
                className="admin-table"
                table={table}
                highlightOnHover
                striped={false}
                withTableBorder={false}
                withColumnBorders={false}
              />
            </div>
            <div className="admin-table-card__footer">{inviteCountControls}</div>
          </Paper>
        )
      ) : null}

      {/* Create Invite Modal */}
      <Modal
        opened={createModalOpen}
        onClose={handleCloseCreateModal}
        title={t("invite.createTitle")}
        centered
      >
        <Stack gap={12}>
          <Select
            label={t("invite.role")}
            placeholder={t("invite.rolePlaceholder")}
            aria-label={t("invite.aria.role")}
            value={inviteRoleId}
            onChange={setInviteRoleId}
            data={roles.map((role) => ({ value: role.id, label: role.name }))}
            searchable
            required
          />
          {/* 两个字段共用一个标签列。各自成行时标签宽度不同，输入框的左边缘会错开。 */}
          <div className="admin-invite-form__fields">
            <Text size="sm" c="dimmed">{t("invite.maxUses")}</Text>
            <NumberInput
              min={1}
              value={inviteMaxUses}
              onChange={(value) => setInviteMaxUses(typeof value === "number" ? value : 1)}
              aria-label={t("invite.aria.maxUses")}
            />
            <Text size="sm" c="dimmed">{t("invite.expiresAt")}</Text>
            <NativeDateTimeInput
              type="datetime-local"
              value={inviteExpiresAt}
              onChange={(event) => setInviteExpiresAt(event.currentTarget.value)}
              aria-label={t("invite.aria.expiresAt")}
            />
          </div>
          <Button
            leftSection={<PlusIcon size={16} />}
            loading={createInvitePending}
            disabled={createInvitePending || !inviteRoleId}
            onClick={handleCreateInvite}
            style={{ width: "100%" }}
          >
            {t("invite.create")}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

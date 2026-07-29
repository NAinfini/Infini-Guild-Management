import type { InviteLink } from "@guild/shared";
import { ActionIcon, Alert, Badge, Button, Group, HoverCard, Loader, Modal, NumberInput, Paper, SegmentedControl, Skeleton, Stack, Text, TextInput, ThemeIcon, Tooltip } from "@mantine/core";
import { AlertTriangleIcon, BanIcon, CircleCheckIcon, CircleXIcon, CopyIcon, InfoCircleIcon, PlusIcon, TrashIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import { useCallback, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useEffectivePermissions } from "../../../hooks/useEffectivePermissions";
import { formatDateTime } from "../../../utils/admin";
import { copyPlainText } from "../../../utils/copy";
import { resolveInviteStatus, type InviteStatus } from "../../../utils/invite-status";
import type { InviteLinkStatsSummary } from "../../../services/AdminService";

type InviteRow = InviteLink;
type InviteStats = InviteLinkStatsSummary;

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
    input: { maxUses: number; expiresAt: string },
    onSuccess: () => void,
  ) => void;
  createInvitePending: boolean;
  inviteStatsLoading: boolean;
  inviteStats: InviteStats | null;
  inviteLinksLoading: boolean;
  inviteLinksError: boolean;
  inviteRows: InviteRow[];
  inviteTotal: number;
  hasMoreInvites: boolean;
  loadingMoreInvites: boolean;
  onLoadMoreInvites: () => void;
  inviteSearch: string;
  onInviteSearchChange: (value: string) => void;
  isInviteInactive: (row: InviteRow) => boolean;
  onRevokeInvite: (inviteId: string) => void;
  onDeleteInvite: (inviteId: string) => void;
};

export function AdminInviteSection({
  inviteVisibility,
  onInviteVisibilityChange,
  onCreateInvite,
  createInvitePending,
  inviteStatsLoading,
  inviteStats,
  inviteLinksLoading,
  inviteLinksError,
  inviteRows,
  inviteTotal,
  hasMoreInvites,
  loadingMoreInvites,
  onLoadMoreInvites,
  inviteSearch,
  onInviteSearchChange,
  isInviteInactive,
  onRevokeInvite,
  onDeleteInvite,
}: AdminInviteSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isAdmin = canManagePermission(["admin.invite.manage"]);
  const loadErrorMessage = tc("loadError");
  const [createModalOpen, createModalHandlers] = useDisclosure(false);
  const [inviteMaxUses, setInviteMaxUses] = useState(10);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");

  const resetCreateForm = useCallback(() => {
    setInviteMaxUses(10);
    setInviteExpiresAt("");
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
    onCreateInvite(
      { maxUses: inviteMaxUses, expiresAt: inviteExpiresAt },
      handleCloseCreateModal,
    );
  }, [handleCloseCreateModal, inviteExpiresAt, inviteMaxUses, onCreateInvite]);

  const handleCopyInviteLink = useCallback((row: InviteRow) => {
    void copyPlainText(`${window.location.origin}/register/${row.code}`);
  }, []);

  const handleRevokeInvite = useCallback((row: InviteRow) => {
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
  }, [confirm, onRevokeInvite, t]);

  const handleDeleteInvite = useCallback((row: InviteRow) => {
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
  }, [confirm, onDeleteInvite, t]);

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
      header: t("invite.table.usage"),
      id: "usage",
      accessorFn: (row) => row.used_count / Math.max(row.max_uses, 1),
      cell: ({ row }) => `${row.original.used_count}/${row.original.max_uses}`,
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
          const inactiveReason = t(`invite.tooltip.${resolveInviteStatus(row.original)}`);
          return (
            <Group gap={8}>
              <Tooltip label={inactiveReason} withArrow disabled={!inactive}>
                <span data-disabled-tooltip-target={inactive || undefined}>
                  <Button
                    size="sm"
                    variant="light"
                    leftSection={<CopyIcon size={16} />}
                    onClick={() => handleCopyInviteLink(row.original)}
                    disabled={inactive}
                  >
                    {t("invite.copy")}
                  </Button>
                </span>
              </Tooltip>
              <Tooltip label={inactive ? inactiveReason : t("invite.revoke")} withArrow>
                <span data-disabled-tooltip-target={inactive || undefined}>
                  <ActionIcon
                    size="lg"
                    color="orange"
                    variant="light"
                    disabled={inactive}
                    onClick={() => handleRevokeInvite(row.original)}
                    aria-label={t("invite.revoke")}
                  >
                    <BanIcon size={16} />
                  </ActionIcon>
                </span>
              </Tooltip>
              <Tooltip label={t("invite.delete")} withArrow>
                <ActionIcon
                  size="lg"
                  color="red"
                  variant="light"
                  onClick={() => handleDeleteInvite(row.original)}
                  aria-label={t("invite.delete")}
                >
                  <TrashIcon size={16} />
                </ActionIcon>
              </Tooltip>
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

  return (
    <Stack gap={12}>
      {/* Toolbar card: segment + stats + search + create button */}
      <Paper withBorder radius="md">
        <div className="admin-invite-card-content">
          <Group wrap="wrap" gap={8} justify="space-between">
            <Group wrap="wrap" gap={8}>
              <SegmentedControl
                value={inviteVisibility}
                onChange={(value) => onInviteVisibilityChange(value as "active" | "expired" | "revoked")}
                data={[
                  { value: "active", label: t("invite.segActive") },
                  { value: "expired", label: t("invite.segExpired") },
                  { value: "revoked", label: t("invite.segRevoked") },
                ]}
              />
              {inviteStatsLoading ? <Loader size="xs" /> : null}
              {inviteStats ? (
                <Group wrap="wrap" gap={6}>
                  <Badge color="gray" variant="light">
                    {t("invite.stats.total")}: {inviteStats.total}
                  </Badge>
                  <Badge color="green" variant="light">
                    {t("invite.stats.active")}: {inviteStats.active}
                  </Badge>
                  <Badge color="red" variant="light">
                    {t("invite.stats.revoked")}: {inviteStats.revoked}
                  </Badge>
                  <Badge color="orange" variant="light">
                    {t("invite.stats.expired")}: {inviteStats.expired}
                  </Badge>
                </Group>
              ) : null}
            </Group>
            <Group wrap="wrap" gap={8}>
              <TextInput
                placeholder={t(isAdmin ? "invite.search" : "invite.searchDateOnly")}
                value={inviteSearch}
                onChange={(event) => onInviteSearchChange(event.currentTarget.value)}
                style={{ width: 220 }}
              />
              {isAdmin ? (
                <Button size="sm" leftSection={<PlusIcon size={16} />} onClick={handleOpenCreateModal}>
                  {t("invite.create")}
                </Button>
              ) : null}
            </Group>
          </Group>
        </div>
      </Paper>

      {/* Table */}
      {inviteLinksLoading ? <Stack gap={8}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {inviteLinksError ? <Alert color="red" title={loadErrorMessage} /> : null}
      {!inviteLinksLoading && !inviteLinksError ? (
        <Paper withBorder radius="md">
          <div className="admin-invite-card-content admin-invite-table-content">
            <DataTableAdapter table={table} />
            <Group justify="space-between" align="center" mt="md">
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
          </div>
        </Paper>
      ) : null}

      {/* Create Invite Modal */}
      <Modal
        opened={createModalOpen}
        onClose={handleCloseCreateModal}
        title={t("invite.createTitle")}
        centered
      >
        <Stack gap={12}>
          <Group align="center" gap={6}>
            <Text size="sm" c="dimmed">{t("invite.maxUses")}</Text>
            <NumberInput
              min={1}
              value={inviteMaxUses}
              onChange={(value) => setInviteMaxUses(typeof value === "number" ? value : 1)}
              aria-label={t("invite.aria.maxUses")}
              style={{ flex: 1 }}
            />
          </Group>
          <Stack gap={4}>
            <Text size="sm" c="dimmed">{t("invite.expiresAt")}</Text>
            <TextInput
              type="datetime-local"
              value={inviteExpiresAt}
              onChange={(event) => setInviteExpiresAt(event.currentTarget.value)}
              aria-label={t("invite.aria.expiresAt")}
            />
          </Stack>
          <Button
            leftSection={<PlusIcon size={16} />}
            loading={createInvitePending}
            disabled={createInvitePending}
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

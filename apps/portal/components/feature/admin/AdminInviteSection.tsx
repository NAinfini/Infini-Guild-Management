import type { InviteLink } from "@guild/shared";
import { Alert, Badge, Group, HoverCard, Loader, Modal, NumberInput, SegmentedControl, Skeleton, Stack, Text, TextInput, ThemeIcon } from "@mantine/core";
import { PortalCard } from "../../shared/PortalCard";
import { AlertTriangleIcon, BanIcon, CircleCheckIcon, CircleXIcon, CopyIcon, InfoCircleIcon, PlusIcon, TrashIcon } from "@portal/components/icons";
import { DepthButton } from "@portal/components/shared/DepthButton";
import {
  InfiniTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@portal/components/shared/InfiniTable";
import type { ColumnDef, PaginationState, SortingState } from "@portal/components/shared/InfiniTable";
import { useEffect, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { modals } from "@mantine/modals";
import { useEffectivePermissions } from "../../../hooks/useEffectivePermissions";
import { formatDateTime } from "../../../utils/admin";
import { copyPlainText } from "../../../utils/copy";
import { TablePagination } from "../../shared/TablePagination";
import type { InviteLinkStatsSummary } from "../../../services/AdminService";

type InviteRow = InviteLink;
type InviteStats = InviteLinkStatsSummary;

type AdminInviteSectionProps = {
  inviteVisibility: "active" | "expired" | "revoked";
  onInviteVisibilityChange: (value: "active" | "expired" | "revoked") => void;
  inviteMaxUses: number;
  onInviteMaxUsesChange: (value: number) => void;
  inviteExpiresAt: string;
  onInviteExpiresAtChange: (value: string) => void;
  onCreateInvite: () => void;
  createInvitePending: boolean;
  createInviteSuccess: boolean;
  inviteStatsLoading: boolean;
  inviteStats: InviteStats | null;
  inviteLinksLoading: boolean;
  inviteLinksError: boolean;
  inviteRows: InviteRow[];
  inviteSearch: string;
  onInviteSearchChange: (value: string) => void;
  isInviteInactive: (row: InviteRow) => boolean;
  onRevokeInvite: (inviteId: string) => void;
  onDeleteInvite: (inviteId: string) => void;
};

export function AdminInviteSection({
  inviteVisibility,
  onInviteVisibilityChange,
  inviteMaxUses,
  onInviteMaxUsesChange,
  inviteExpiresAt,
  onInviteExpiresAtChange,
  onCreateInvite,
  createInvitePending,
  createInviteSuccess,
  inviteStatsLoading,
  inviteStats,
  inviteLinksLoading,
  inviteLinksError,
  inviteRows,
  inviteSearch,
  onInviteSearchChange,
  isInviteInactive,
  onRevokeInvite,
  onDeleteInvite,
}: AdminInviteSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isAdmin = canManagePermission(["admin.invite.manage"]);
  const loadErrorMessage = tc("loadError");
  const [createModalOpen, createModalHandlers] = useDisclosure(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  useEffect(() => {
    if (createInviteSuccess && createModalOpen) {
      createModalHandlers.close();
    }
  }, [createInviteSuccess, createModalOpen, createModalHandlers]);

  const handleCopyInviteLink = (row: InviteRow) => {
    void copyPlainText(`${window.location.origin}/register/${row.code}`);
  };

  const handleRevokeInvite = (row: InviteRow) => {
    void (async () => {
      const confirmed = await new Promise<boolean>((resolve) => {
        modals.openConfirmModal({
          title: t("confirm.revokeInvite.title"),
          children: t("confirm.revokeInvite.description", { code: row.code }),
          labels: { confirm: t("invite.revoke"), cancel: t("common:action.cancel") },
          confirmProps: { color: "red" },
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
          closeOnConfirm: true,
          closeOnCancel: true,
          centered: true,
        });
      });
      if (!confirmed) {
        return;
      }
      onRevokeInvite(row.id);
    })();
  };

  const handleDeleteInvite = (row: InviteRow) => {
    void (async () => {
      const confirmed = await new Promise<boolean>((resolve) => {
        modals.openConfirmModal({
          title: t("confirm.deleteInvite.title"),
          children: t("confirm.deleteInvite.description", { code: row.code }),
          labels: { confirm: t("common:action.delete"), cancel: t("common:action.cancel") },
          confirmProps: { color: "red" },
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
          closeOnConfirm: true,
          closeOnCancel: true,
          centered: true,
        });
      });
      if (!confirmed) {
        return;
      }
      onDeleteInvite(row.id);
    })();
  };

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

    if (!isAdmin) {
      cols.push({
        header: t("invite.table.status"),
        id: "status",
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          const expired = Boolean(r.expires_at && Date.parse(r.expires_at) <= Date.now());
          const fullyUsed = r.used_count >= r.max_uses;
          if (r.revoked_at) return (
            <HoverCard width={260} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target><Badge data-animate-icon-trigger color="red" variant="light">{t("invite.status.revoked")}</Badge></HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="red" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <AlertTriangleIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3} mb={4}>{t("invite.status.revoked")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("invite.tooltip.revoked")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
          );
          if (fullyUsed) return (
            <HoverCard width={260} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target><Badge data-animate-icon-trigger color="portal-copper" variant="light">{t("invite.status.fullyUsed")}</Badge></HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="portal-copper" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <CircleXIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3} mb={4}>{t("invite.status.fullyUsed")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("invite.tooltip.fullyUsed")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
          );
          if (expired) return (
            <HoverCard width={260} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target><Badge data-animate-icon-trigger color="portal-copper" variant="light">{t("invite.status.expired")}</Badge></HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="portal-copper" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <InfoCircleIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3} mb={4}>{t("invite.status.expired")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("invite.tooltip.expired")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
          );
          return (
            <HoverCard width={260} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target><Badge data-animate-icon-trigger color="green" variant="light">{t("invite.status.active")}</Badge></HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="green" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <CircleCheckIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3} mb={4}>{t("invite.status.active")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("invite.tooltip.active")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
          );
        },
      });
    }

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
          return (
            <Group gap={8}>
              <DepthButton size="sm" type="info" before={<CopyIcon size={16} />} onClick={() => handleCopyInviteLink(row.original)} disabled={inactive}>
                {t("invite.copy")}
              </DepthButton>
              <DepthButton size="sm" type="warning" iconOnly before={<BanIcon size={16} />} disabled={inactive} onClick={() => handleRevokeInvite(row.original)} tooltip={{ label: t("invite.revoke"), withArrow: true }} />
              <DepthButton size="sm" type="danger" iconOnly before={<TrashIcon size={16} />} onClick={() => handleDeleteInvite(row.original)} tooltip={{ label: t("invite.delete"), withArrow: true }} />
            </Group>
          );
        },
      });
    }

    return cols;
   
  }, [isAdmin, t, isInviteInactive]);

  const table = useReactTable({
    data: inviteRows,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <Stack gap={12}>
      {/* Toolbar card: segment + stats + search + create button */}
      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
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
                  <Badge color="portal-bronze" variant="light">
                    {t("invite.stats.total")}: {inviteStats.total}
                  </Badge>
                  <Badge color="green" variant="light">
                    {t("invite.stats.active")}: {inviteStats.active}
                  </Badge>
                  <Badge color="red" variant="light">
                    {t("invite.stats.revoked")}: {inviteStats.revoked}
                  </Badge>
                  <Badge color="portal-copper" variant="light">
                    {t("invite.stats.expired")}: {inviteStats.expired}
                  </Badge>
                </Group>
              ) : null}
            </Group>
            <Group wrap="wrap" gap={8}>
              <TextInput
                placeholder={t("invite.search")}
                value={inviteSearch}
                onChange={(event) => onInviteSearchChange(event.currentTarget.value)}
                style={{ width: 220 }}
              />
              {isAdmin ? (
                <DepthButton size="sm" type="primary" before={<PlusIcon size={16} />} onClick={createModalHandlers.open}>
                  {t("invite.create")}
                </DepthButton>
              ) : null}
            </Group>
          </Group>
        </div>
      </PortalCard>

      {/* Table */}
      {inviteLinksLoading ? <Stack gap={8}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {inviteLinksError ? <Alert color="portal-copper" title={loadErrorMessage} /> : null}
      {!inviteLinksLoading && !inviteLinksError ? (
        <PortalCard interactive={false}>
          <div style={{ padding: "1.2rem", overflowX: "auto" }}>
            <InfiniTable table={table} />
            <TablePagination table={table} />
          </div>
        </PortalCard>
      ) : null}

      {/* Create Invite Modal */}
      <Modal
        opened={createModalOpen}
        onClose={createModalHandlers.close}
        title={t("invite.createTitle")}
        centered
      >
        <Stack gap={12}>
          <Group align="center" gap={6}>
            <Text size="sm" c="dimmed">{t("invite.maxUses")}</Text>
            <NumberInput
              min={1}
              value={inviteMaxUses}
              onChange={(value) => onInviteMaxUsesChange(typeof value === "number" ? value : 1)}
              aria-label={t("invite.aria.maxUses")}
              style={{ flex: 1 }}
            />
          </Group>
          <Stack gap={4}>
            <Text size="sm" c="dimmed">{t("invite.expiresAt")}</Text>
            <TextInput
              type="datetime-local"
              value={inviteExpiresAt || undefined}
              onChange={(event) => onInviteExpiresAtChange(event.currentTarget.value)}
              aria-label={t("invite.aria.expiresAt")}
            />
          </Stack>
          <DepthButton
            type="primary"
            before={<PlusIcon size={16} />}
            loading={createInvitePending}
            disabled={createInvitePending}
            onClick={() => {
              onCreateInvite();
            }}
            style={{ width: "100%" }}
          >
            {t("invite.create")}
          </DepthButton>
        </Stack>
      </Modal>
    </Stack>
  );
}

import { Alert, Badge, Button, Group, Loader, Modal, NumberInput, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { IconBan, IconCopy, IconPlus } from "@tabler/icons-react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { fetchAdminInviteLinks, fetchAdminInviteStats } from "../../../api/queries/admin";
import { InfiniTable } from "../../shared/InfiniTable";

type InviteRow = Awaited<ReturnType<typeof fetchAdminInviteLinks>>[number];
type InviteStats = Awaited<ReturnType<typeof fetchAdminInviteStats>>;

type AdminInviteSectionProps = {
  inviteVisibility: "active" | "expired" | "revoked";
  onInviteVisibilityChange: (value: "active" | "expired" | "revoked") => void;
  isAdmin: boolean;
  inviteMaxUses: number;
  onInviteMaxUsesChange: (value: number) => void;
  inviteExpiresAt: string;
  onInviteExpiresAtChange: (value: string) => void;
  onCreateInvite: () => void;
  inviteStatsLoading: boolean;
  inviteStats: InviteStats | null;
  inviteLinksLoading: boolean;
  inviteLinksError: boolean;
  loadErrorMessage: string;
  inviteRows: InviteRow[];
  inviteSearch: string;
  onInviteSearchChange: (value: string) => void;
  isInviteInactive: (row: InviteRow) => boolean;
  formatDateTime: (iso: string | null) => string;
  onCopyInviteLink: (row: InviteRow) => void;
  onRevokeInvite: (row: InviteRow) => void;
};

export function AdminInviteSection({
  inviteVisibility,
  onInviteVisibilityChange,
  isAdmin,
  inviteMaxUses,
  onInviteMaxUsesChange,
  inviteExpiresAt,
  onInviteExpiresAtChange,
  onCreateInvite,
  inviteStatsLoading,
  inviteStats,
  inviteLinksLoading,
  inviteLinksError,
  loadErrorMessage,
  inviteRows,
  inviteSearch,
  onInviteSearchChange,
  isInviteInactive,
  formatDateTime,
  onCopyInviteLink,
  onRevokeInvite,
}: AdminInviteSectionProps) {
  const { t } = useTranslation("admin");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

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
          if (r.revoked_at) return <Badge color="infini-danger" variant="light">{t("invite.status.revoked")}</Badge>;
          if (fullyUsed) return <Badge color="infini-warning" variant="light">{t("invite.status.fullyUsed")}</Badge>;
          if (expired) return <Badge color="infini-warning" variant="light">{t("invite.status.expired")}</Badge>;
          return <Badge color="infini-success" variant="light">{t("invite.status.active")}</Badge>;
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
              <Button size="xs" leftSection={<IconCopy size={16} />} onClick={() => onCopyInviteLink(row.original)} disabled={inactive}>
                {t("invite.copy")}
              </Button>
              <Button size="xs" color="infini-danger" leftSection={<IconBan size={16} />} disabled={inactive} onClick={() => onRevokeInvite(row.original)}>
                {t("invite.revoke")}
              </Button>
            </Group>
          );
        },
      });
    }

    return cols;
  }, [isAdmin, t, formatDateTime, isInviteInactive, onCopyInviteLink, onRevokeInvite]);

  const table = useReactTable({
    data: inviteRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <Stack gap={12}>
      {/* Toolbar card: segment + stats + search + create button */}
      <InfiniCard interactive={false}>
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
                  <Badge color="infini-primary" variant="light">
                    {t("invite.stats.total")}: {inviteStats.total}
                  </Badge>
                  <Badge color="infini-success" variant="light">
                    {t("invite.stats.active")}: {inviteStats.active}
                  </Badge>
                  <Badge color="infini-danger" variant="light">
                    {t("invite.stats.revoked")}: {inviteStats.revoked}
                  </Badge>
                  <Badge color="infini-warning" variant="light">
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
                <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setCreateModalOpen(true)}>
                  {t("invite.create")}
                </Button>
              ) : null}
            </Group>
          </Group>
        </div>
      </InfiniCard>

      {/* Table */}
      {inviteLinksLoading ? <Loader size="sm" /> : null}
      {inviteLinksError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}
      {!inviteLinksLoading && !inviteLinksError ? (
        <InfiniCard interactive={false}>
          <div style={{ padding: "1.2rem", overflowX: "auto" }}>
            <InfiniTable table={table} />
          </div>
        </InfiniCard>
      ) : null}

      {/* Create Invite Modal */}
      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
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
              aria-label="Invite max uses"
              style={{ flex: 1 }}
            />
          </Group>
          <Stack gap={4}>
            <Text size="sm" c="dimmed">{t("invite.expiresAt")}</Text>
            <TextInput
              type="datetime-local"
              value={inviteExpiresAt}
              onChange={(event) => onInviteExpiresAtChange(event.currentTarget.value)}
              aria-label="Invite expiration time"
            />
          </Stack>
          <Button
            fullWidth
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              onCreateInvite();
              setCreateModalOpen(false);
            }}
          >
            {t("invite.create")}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

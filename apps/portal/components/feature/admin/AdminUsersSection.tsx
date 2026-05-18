import { PortalCard } from "../../shared/PortalCard";
import type { AdminRole } from "@guild/shared";
import {
  Alert,
  Group,
  Skeleton,
  Progress,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { CopyIcon, EyeIcon, KeyIcon, PlayIcon, PlayerPauseIcon, SearchIcon, TrashIcon, UserPlusIcon } from "@portal/components/icons";
import {
  InfiniTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@portal/components/shared/InfiniTable";
import type { ColumnDef, PaginationState, SortingState } from "@portal/components/shared/InfiniTable";
import { useMemo, useState } from "react";
import { useClipboard } from "@mantine/hooks";
import { type ContextMenuItemOptions, useContextMenu } from "mantine-contextmenu";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { TablePagination } from "../../shared/TablePagination";
import type { UsersListResponse } from "../../../services/UserService";

export type AdminUserRow = UsersListResponse["data"][number];

type AdminUsersSectionProps = {
  usersLoading: boolean;
  usersError: boolean;
  isAdmin: boolean;
  onOpenCreateMember: () => void;
  selectedUserIds: string[];
  batchSelectionLimit: number;
  onBatchRole: (userIds: string[], role: string) => void;
  onBatchActivate: (userIds: string[]) => void;
  onBatchDeactivate: (userIds: string[]) => void;
  onBatchDelete: (userIds: string[]) => void;
  onSingleRoleChange: (userId: string, role: string) => void;
  onSingleActivate: (userId: string) => void;
  onSingleDeactivate: (userId: string) => void;
  onSingleResetPassword: (userId: string) => void;
  batchRolePending: boolean;
  batchActivatePending: boolean;
  batchDeactivatePending: boolean;
  batchDeletePending: boolean;
  singleRolePending: boolean;
  singleActivationPending: boolean;
  singleResetPasswordPending: boolean;
  isBatchPending: boolean;
  batchProgress: number;
  userRows: AdminUserRow[];
  userColumns: ColumnDef<AdminUserRow, unknown>[];
  onOpenMemberDetail: (userId: string) => void;
  onSelectionChange: (keys: string[]) => void;
  roles: AdminRole[];
  memberSearch: string;
  onMemberSearchChange: (value: string) => void;
};

export function AdminUsersSection({
  usersLoading,
  usersError,
  isAdmin,
  onOpenCreateMember,
  selectedUserIds,
  batchSelectionLimit,
  onBatchRole,
  onBatchActivate,
  onBatchDeactivate,
  onBatchDelete,
  onSingleRoleChange,
  onSingleActivate,
  onSingleDeactivate,
  onSingleResetPassword,
  batchRolePending,
  batchActivatePending,
  batchDeactivatePending,
  batchDeletePending,
  singleRolePending,
  singleActivationPending,
  singleResetPasswordPending,
  isBatchPending,
  batchProgress,
  userRows,
  userColumns,
  onOpenMemberDetail,
  onSelectionChange,
  roles,
  memberSearch,
  onMemberSearchChange,
}: AdminUsersSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const clipboard = useClipboard();
  const loadErrorMessage = tc("loadError");
  const heading = <Title order={2} m={0} fz={16}>{t("tab.member")}</Title>;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const { showContextMenu } = useContextMenu();

  const selectedIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);
  const usersById = useMemo(() => new Map(userRows.map((row) => [row.user.id, row])), [userRows]);

  const table = useReactTable({
    data: userRows,
    columns: userColumns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.user.id,
  });

  const orderedRowIds = useMemo(
    () => table.getRowModel().rows.map((row) => row.original.user.id),
    [table, sorting, userRows],
  );

  const handleRowClick = (
    userId: string,
    event: ReactMouseEvent<HTMLTableRowElement>,
  ) => {
    if (!isAdmin) {
      return;
    }

    const orderedIndex = orderedRowIds.indexOf(userId);
    if (orderedIndex === -1) {
      return;
    }

    const withModifier = event.ctrlKey || event.metaKey;
    const withRange = event.shiftKey;
    if (withRange) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    if (withRange && selectionAnchorId) {
      const anchorIndex = orderedRowIds.indexOf(selectionAnchorId);
      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, orderedIndex);
        const end = Math.max(anchorIndex, orderedIndex);
        const rangeIds = orderedRowIds.slice(start, end + 1);
        const nextSet = withModifier ? new Set(selectedUserIds) : new Set<string>();
        rangeIds.forEach((id) => nextSet.add(id));
        onSelectionChange(Array.from(nextSet));
        setSelectionAnchorId(userId);
        return;
      }
    }

    if (withModifier) {
      const nextSet = new Set(selectedUserIds);
      if (nextSet.has(userId)) {
        nextSet.delete(userId);
      } else {
        nextSet.add(userId);
      }
      onSelectionChange(Array.from(nextSet));
      setSelectionAnchorId(userId);
      return;
    }

    onSelectionChange([userId]);
    setSelectionAnchorId(userId);
  };

  const handleRowContextMenu = (
    userId: string,
    event: ReactMouseEvent<HTMLTableRowElement>,
  ) => {
    if (!isAdmin) {
      return;
    }

    const nextContextUserIds = selectedIdSet.has(userId) && selectedUserIds.length > 0
      ? selectedUserIds
      : [userId];
    const nextContextRows = nextContextUserIds
      .map((contextUserId) => usersById.get(contextUserId))
      .filter(Boolean) as AdminUserRow[];
    const isBatchContext = nextContextUserIds.length > 1;
    const contextSingleUserId = nextContextUserIds.length === 1 ? nextContextUserIds[0] ?? null : null;
    const anyActiveInContext = nextContextRows.some((row) => row.user.is_active);
    const anyInactiveInContext = nextContextRows.some((row) => !row.user.is_active);

    if (!selectedIdSet.has(userId)) {
      onSelectionChange([userId]);
      setSelectionAnchorId(userId);
    }

    const roleItems: ContextMenuItemOptions[] = roles
      .slice()
      .sort((a, b) => a.level - b.level)
      .map((role) => ({
        key: `role-${role.id}`,
        disabled:
          (isBatchContext && role.id === "admin") ||
          singleRolePending ||
          batchRolePending,
        onClick: () => {
          if (isBatchContext) {
            if (role.id === "admin") {
              return;
            }
            onBatchRole(nextContextUserIds, role.id);
            return;
          }

          if (!contextSingleUserId) {
            return;
          }

          onSingleRoleChange(contextSingleUserId, role.id);
        },
        title: role.name,
      }));

    const items: ContextMenuItemOptions[] = [
      {
        key: "selection-label",
        className: "infini-menu-item--label",
        disabled: true,
        onClick: () => {},
        title: isBatchContext
          ? t("member.context.batchSelected", { count: nextContextUserIds.length })
          : nextContextRows[0]?.user.username ?? "-",
      },
      { key: "divider-identity" },
      {
        key: "detail",
        disabled: !contextSingleUserId,
        icon: <EyeIcon size={14} />,
        onClick: () => {
          if (contextSingleUserId) {
            onOpenMemberDetail(contextSingleUserId);
          }
        },
        title: t("member.action.detail"),
      },
      {
        key: "copy-row",
        icon: <CopyIcon size={14} />,
        onClick: () => {
          const lines = nextContextRows.map((row) =>
            [
              row.user.username,
              row.profile.classes.join(", "),
              String(row.profile.power),
              row.user.role,
              row.user.is_active ? t("member.status.active") : t("member.status.inactive"),
            ].join(", "),
          );
          clipboard.copy(lines.join("\n") + "\n");
        },
        title: isBatchContext ? t("member.context.copyRows") : t("member.context.copyRow"),
      },
      {
        key: "change-role",
        items: roleItems,
        title: t("member.context.changeRole"),
      },
      ...(anyInactiveInContext
        ? [{
            key: "activate",
            disabled: singleActivationPending || batchActivatePending,
            icon: <PlayIcon size={14} />,
            onClick: () => {
              if (isBatchContext) {
                onBatchActivate(nextContextUserIds);
              } else if (contextSingleUserId) {
                onSingleActivate(contextSingleUserId);
              }
            },
            title: isBatchContext ? t("member.context.batchActivate") : t("member.reactivate"),
          } satisfies ContextMenuItemOptions]
        : []),
      ...(anyActiveInContext
        ? [{
            key: "deactivate",
            disabled: singleActivationPending || batchDeactivatePending,
            icon: <PlayerPauseIcon size={14} />,
            onClick: () => {
              if (isBatchContext) {
                onBatchDeactivate(nextContextUserIds);
              } else if (contextSingleUserId) {
                onSingleDeactivate(contextSingleUserId);
              }
            },
            title: isBatchContext ? t("member.context.batchDeactivate") : t("member.deactivate"),
          } satisfies ContextMenuItemOptions]
        : []),
      ...(!isBatchContext && contextSingleUserId
        ? [{
            key: "reset-password",
            disabled: singleResetPasswordPending,
            icon: <KeyIcon size={14} />,
            onClick: () => {
              onSingleResetPassword(contextSingleUserId);
            },
            title: t("member.resetPassword"),
          } satisfies ContextMenuItemOptions]
        : []),
      { key: "divider-actions" },
      {
        key: "create-member",
        icon: <UserPlusIcon size={14} />,
        onClick: () => {
          onOpenCreateMember();
        },
        title: t("member.context.createMember"),
      },
      {
        key: "delete",
        className: "infini-menu-item--danger",
        color: "red",
        disabled: batchDeletePending,
        icon: <TrashIcon size={14} />,
        onClick: () => {
          onBatchDelete(nextContextUserIds);
        },
        title: isBatchContext ? t("member.context.batchDelete") : t("member.context.delete"),
      },
    ];

    showContextMenu(items)(event);
  };

  return (
    <Stack gap={12}>
      {heading}
      {usersLoading ? <Stack gap={8}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {usersError ? <Alert color="yellow" title={loadErrorMessage} /> : null}
      {!usersLoading && !usersError ? (
        <>
          {isAdmin ? (
            <Group gap={8} wrap="wrap" align="center">
              <TextInput
                value={memberSearch}
                onChange={(event) => onMemberSearchChange(event.currentTarget.value)}
                placeholder={t("member.search.placeholder")}
                leftSection={<SearchIcon size={14} />}
                style={{ flex: 1 }} miw={200} maw={360}
                size="sm"
              />
              <Text c="dimmed" size="sm">
                {t("member.selectionHint")}
              </Text>
              <Text c="dimmed" size="sm">
                {t("member.selected", { count: selectedUserIds.length })} / {batchSelectionLimit}
              </Text>
              {isBatchPending || batchProgress > 0 ? (
                <Progress value={batchProgress} animated={isBatchPending} color={isBatchPending ? "blue" : "green"} style={{ width: "100%" }} />
              ) : null}
            </Group>
          ) : null}

          <PortalCard interactive={false}>
            <ScrollArea type="auto" style={{ padding: "1.2rem" }}>
              <InfiniTable
                table={table}
                highlightOnHover
                onRowDoubleClick={(row) => onOpenMemberDetail(row.original.user.id)}
                onRowClick={(row, event) => handleRowClick(row.original.user.id, event)}
                onRowContextMenu={(row, event) => handleRowContextMenu(row.original.user.id, event)}
                rowClassName={(row) =>
                  selectedIdSet.has(row.original.user.id) ? "admin-member-row-selected" : undefined
                }
              />
              <TablePagination table={table} />
            </ScrollArea>
          </PortalCard>
        </>
      ) : null}
    </Stack>
  );
}

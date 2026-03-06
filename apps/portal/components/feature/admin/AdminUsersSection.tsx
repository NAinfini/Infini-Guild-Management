import { InfiniCard } from "@infini-dev-kit/frontend/components";
import type { AdminRole } from "@guild/shared";
import {
  Alert,
  Group,
  Loader,
  Menu,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconChevronRight,
  IconCopy,
  IconEye,
  IconKey,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
  IconTrash,
  IconUserPlus,
} from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { SortingState } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import type { fetchUsersList } from "../../../api/queries/users";
import { InfiniTable } from "../../shared/InfiniTable";

export type AdminUserRow = Awaited<ReturnType<typeof fetchUsersList>>["data"][number];

type AdminUsersSectionProps = {
  heading: ReactNode;
  usersLoading: boolean;
  usersError: boolean;
  loadErrorMessage: string;
  isAdmin: boolean;
  onOpenCreateMember: () => void;
  selectedUserIds: string[];
  selectedLabel: string;
  selectionHintLabel: string;
  batchSelectionLimit: number;
  onBatchRole: (userIds: string[], role: "member" | "moderator") => void;
  onBatchActivate: (userIds: string[]) => void;
  onBatchDeactivate: (userIds: string[]) => void;
  onBatchDelete: (userIds: string[]) => void;
  onSingleRoleChange: (userId: string, role: "admin" | "moderator" | "member") => void;
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
  heading,
  usersLoading,
  usersError,
  loadErrorMessage,
  isAdmin,
  onOpenCreateMember,
  selectedUserIds,
  selectedLabel,
  selectionHintLabel,
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
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    opened: boolean;
    x: number;
    y: number;
    targetUserId: string | null;
  }>({
    opened: false,
    x: 0,
    y: 0,
    targetUserId: null,
  });

  const selectedIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);
  const usersById = useMemo(() => new Map(userRows.map((row) => [row.user.id, row])), [userRows]);

  const table = useReactTable({
    data: userRows,
    columns: userColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.user.id,
  });

  const orderedRowIds = useMemo(
    () => table.getRowModel().rows.map((row) => row.original.user.id),
    [table, sorting, userRows],
  );

  const closeContextMenu = () => {
    setContextMenu((current) => ({ ...current, opened: false }));
  };

  useEffect(() => {
    if (!contextMenu.opened) {
      return;
    }
    const handleWindowBlur = () => closeContextMenu();
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [contextMenu.opened]);

  const contextUserIds = useMemo(() => {
    if (!contextMenu.targetUserId) {
      return [];
    }
    if (selectedIdSet.has(contextMenu.targetUserId) && selectedUserIds.length > 0) {
      return selectedUserIds;
    }
    return [contextMenu.targetUserId];
  }, [contextMenu.targetUserId, selectedIdSet, selectedUserIds]);

  const contextRows = useMemo(
    () => contextUserIds.map((userId) => usersById.get(userId)).filter(Boolean) as AdminUserRow[],
    [contextUserIds, usersById],
  );
  const isBatchContext = contextUserIds.length > 1;
  const anyActiveInContext = contextRows.some((row) => row.user.is_active);
  const anyInactiveInContext = contextRows.some((row) => !row.user.is_active);
  const contextSingleUserId = contextUserIds.length === 1 ? contextUserIds[0] ?? null : null;

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
    event.preventDefault();

    if (!selectedIdSet.has(userId)) {
      onSelectionChange([userId]);
      setSelectionAnchorId(userId);
    }

    setContextMenu({
      opened: true,
      x: event.clientX,
      y: event.clientY,
      targetUserId: userId,
    });
  };

  const handleRoleAction = (roleId: string) => {
    if (isBatchContext) {
      if (roleId === "admin") {
        return;
      }
      onBatchRole(contextUserIds, roleId as "member" | "moderator");
      closeContextMenu();
      return;
    }
    if (!contextSingleUserId) {
      return;
    }
    onSingleRoleChange(contextSingleUserId, roleId as "admin" | "moderator" | "member");
    closeContextMenu();
  };

  const handleActivateAction = () => {
    if (isBatchContext) {
      onBatchActivate(contextUserIds);
    } else if (contextSingleUserId) {
      onSingleActivate(contextSingleUserId);
    }
    closeContextMenu();
  };

  const handleDeactivateAction = () => {
    if (isBatchContext) {
      onBatchDeactivate(contextUserIds);
    } else if (contextSingleUserId) {
      onSingleDeactivate(contextSingleUserId);
    }
    closeContextMenu();
  };

  const handleDeleteAction = () => {
    onBatchDelete(contextUserIds);
    closeContextMenu();
  };

  return (
    <Stack gap={12}>
      {heading}
      {usersLoading ? <Loader size="sm" /> : null}
      {usersError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}
      {!usersLoading && !usersError ? (
        <>
          {isAdmin ? (
            <Group gap={8} wrap="wrap" align="center">
              <TextInput
                value={memberSearch}
                onChange={(event) => onMemberSearchChange(event.currentTarget.value)}
                placeholder={t("member.search.placeholder")}
                leftSection={<IconSearch size={14} />}
                style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                size="sm"
              />
              <Text c="dimmed" size="sm">
                {selectionHintLabel}
              </Text>
              <Text c="dimmed" size="sm">
                {selectedLabel} / {batchSelectionLimit}
              </Text>
              {isBatchPending || batchProgress > 0 ? (
                <Progress value={batchProgress} animated={isBatchPending} color={isBatchPending ? "blue" : "green"} style={{ width: "100%" }} />
              ) : null}
            </Group>
          ) : null}

          <InfiniCard interactive={false}>
            <div className="admin-member-table-wrap" style={{ padding: "1.2rem", overflowX: "auto" }}>
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
            </div>
          </InfiniCard>

          {isAdmin ? (
            <Menu
              opened={contextMenu.opened}
              onChange={(opened) => {
                if (!opened) {
                  closeContextMenu();
                }
              }}
              closeOnItemClick
              closeOnEscape
              shadow="md"
              width={220}
              position="bottom-start"
              withinPortal
              classNames={{
                dropdown: "admin-users-context-menu-dropdown",
                item: "admin-users-context-menu-item",
                label: "admin-users-context-menu-label",
                divider: "admin-users-context-menu-divider",
              }}
            >
              <Menu.Target>
                <div
                  style={{
                    position: "fixed",
                    left: contextMenu.x,
                    top: contextMenu.y,
                    width: 1,
                    height: 1,
                    pointerEvents: "none",
                  }}
                />
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  {isBatchContext
                    ? t("member.context.batchSelected", { count: contextUserIds.length })
                    : contextRows[0]?.user.username ?? "-"}
                </Menu.Label>
                <Menu.Item
                  leftSection={<IconEye size={14} />}
                  onClick={() => {
                    if (contextSingleUserId) {
                      onOpenMemberDetail(contextSingleUserId);
                    }
                    closeContextMenu();
                  }}
                  disabled={!contextSingleUserId}
                >
                  {t("member.action.detail")}
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconCopy size={14} />}
                  onClick={() => {
                    const lines = contextRows.map((row) =>
                      [
                        row.user.username,
                        row.profile.wechat_name ?? "",
                        row.profile.discord_id ?? "",
                        row.profile.classes.join(", "),
                        String(row.profile.power),
                        row.user.role,
                        row.user.is_active ? "Active" : "Inactive",
                      ].join(", "),
                    );
                    void navigator.clipboard.writeText(lines.join("\n") + "\n");
                    closeContextMenu();
                  }}
                >
                  {isBatchContext
                    ? t("member.context.copyRows")
                    : t("member.context.copyRow")}
                </Menu.Item>

                {isAdmin ? (
                  <>
                    <Menu
                      trigger="hover"
                      openDelay={60}
                      closeDelay={120}
                      position="right-start"
                      offset={6}
                      withinPortal
                      classNames={{
                        dropdown: "admin-users-context-menu-dropdown",
                        item: "admin-users-context-menu-item",
                        label: "admin-users-context-menu-label",
                        divider: "admin-users-context-menu-divider",
                      }}
                    >
                      <Menu.Target>
                        <Menu.Item rightSection={<IconChevronRight size={14} />} closeMenuOnClick={false}>
                          {t("member.context.changeRole")}
                        </Menu.Item>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {roles
                          .slice()
                          .sort((a, b) => a.level - b.level)
                          .map((role) => (
                            <Menu.Item
                              key={role.id}
                              onClick={() => handleRoleAction(role.id)}
                              disabled={
                                (isBatchContext && role.id === "admin") ||
                                singleRolePending ||
                                batchRolePending
                              }
                            >
                              {role.name}
                            </Menu.Item>
                          ))}
                      </Menu.Dropdown>
                    </Menu>

                    {anyInactiveInContext ? (
                      <Menu.Item
                        leftSection={<IconPlayerPlay size={14} />}
                        onClick={handleActivateAction}
                        disabled={singleActivationPending || batchActivatePending}
                      >
                        {isBatchContext ? t("member.context.batchActivate") : t("member.reactivate")}
                      </Menu.Item>
                    ) : null}
                    {anyActiveInContext ? (
                      <Menu.Item
                        leftSection={<IconPlayerPause size={14} />}
                        onClick={handleDeactivateAction}
                        disabled={singleActivationPending || batchDeactivatePending}
                      >
                        {isBatchContext ? t("member.context.batchDeactivate") : t("member.deactivate")}
                      </Menu.Item>
                    ) : null}

                    {!isBatchContext && contextSingleUserId ? (
                      <Menu.Item
                        leftSection={<IconKey size={14} />}
                        onClick={() => {
                          onSingleResetPassword(contextSingleUserId);
                          closeContextMenu();
                        }}
                        disabled={singleResetPasswordPending}
                      >
                        {t("member.resetPassword")}
                      </Menu.Item>
                    ) : null}

                    <Menu.Divider />
                    <Menu.Item
                      leftSection={<IconUserPlus size={14} />}
                      onClick={() => {
                        onOpenCreateMember();
                        closeContextMenu();
                      }}
                    >
                      {t("member.context.createMember")}
                    </Menu.Item>
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={handleDeleteAction}
                      disabled={batchDeletePending}
                    >
                      {isBatchContext ? t("member.context.batchDelete") : t("member.context.delete")}
                    </Menu.Item>
                  </>
                ) : null}
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}

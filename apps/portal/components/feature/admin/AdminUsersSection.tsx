import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Progress,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type { ReactNode } from "react";
import type { fetchUsersList } from "../../../api/queries/users";

type AdminUserRow = Awaited<ReturnType<typeof fetchUsersList>>["data"][number];

type ColumnDef<T = unknown> = {
  key?: string;
  title?: ReactNode;
  dataIndex?: keyof T | string | Array<string | number>;
  width?: string | number;
  render?: (value: unknown, row: T, index: number) => ReactNode;
};

type AdminUsersSectionProps = {
  heading: ReactNode;
  usersLoading: boolean;
  usersError: boolean;
  loadErrorMessage: string;
  isAdmin: boolean;
  batchRole: "member" | "moderator";
  onBatchRoleChange: (value: "member" | "moderator") => void;
  selectedUserIds: string[];
  selectedLabel: string;
  batchSelectionLimit: number;
  batchRoleButtonLabel: string;
  batchReactivateButtonLabel: string;
  batchDeleteButtonLabel: string;
  onBatchRole: () => void;
  onBatchReactivate: () => void;
  onBatchDelete: () => void;
  batchRolePending: boolean;
  batchReactivatePending: boolean;
  batchDeletePending: boolean;
  isBatchPending: boolean;
  batchProgress: number;
  userRows: AdminUserRow[];
  userColumns: ColumnDef<AdminUserRow>[];
  onOpenMemberDetail: (userId: string) => void;
  onSelectionChange: (keys: string[]) => void;
};

function resolveDataIndex<T extends object>(row: T, dataIndex: ColumnDef<T>["dataIndex"]): unknown {
  if (!dataIndex) {
    return row;
  }
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[String(key)];
  }, row);
}

export function AdminUsersSection({
  heading,
  usersLoading,
  usersError,
  loadErrorMessage,
  isAdmin,
  batchRole,
  onBatchRoleChange,
  selectedUserIds,
  selectedLabel,
  batchSelectionLimit,
  batchRoleButtonLabel,
  batchReactivateButtonLabel,
  batchDeleteButtonLabel,
  onBatchRole,
  onBatchReactivate,
  onBatchDelete,
  batchRolePending,
  batchReactivatePending,
  batchDeletePending,
  isBatchPending,
  batchProgress,
  userRows,
  userColumns,
  onOpenMemberDetail,
  onSelectionChange,
}: AdminUsersSectionProps) {
  return (
    <Stack gap={12}>
      {heading}
      {usersLoading ? <Loader size="sm" /> : null}
      {usersError ? <Alert color="yellow" title={loadErrorMessage} /> : null}
      {!usersLoading && !usersError ? (
        <>
          {isAdmin ? (
            <InfiniCard>
              <div style={{ padding: "1.2rem" }}>
                <Stack gap={10}>
                  <Group wrap="wrap" gap={8}>
                    <Select
                      value={batchRole}
                      onChange={(value) => value && onBatchRoleChange(value as "member" | "moderator")}
                      data={[
                        { value: "member", label: "member" },
                        { value: "moderator", label: "moderator" },
                      ]}
                      style={{ width: 160 }}
                    />
                    <Button onClick={onBatchRole} disabled={selectedUserIds.length === 0} loading={batchRolePending}>
                      {batchRoleButtonLabel}
                    </Button>
                    <Button
                      onClick={onBatchReactivate}
                      disabled={selectedUserIds.length === 0}
                      loading={batchReactivatePending}
                    >
                      {batchReactivateButtonLabel}
                    </Button>
                    <MotionButton
                      danger
                      onClick={onBatchDelete}
                      disabled={selectedUserIds.length === 0}
                      loading={batchDeletePending}
                    >
                      {batchDeleteButtonLabel}
                    </MotionButton>
                    <Text c="dimmed" size="sm">
                      {selectedLabel} / {batchSelectionLimit}
                    </Text>
                  </Group>
                  {isBatchPending || batchProgress > 0 ? (
                    <Progress value={batchProgress} animated={isBatchPending} color={isBatchPending ? "blue" : "green"} />
                  ) : null}
                </Stack>
              </div>
            </InfiniCard>
          ) : null}

          <InfiniCard>
            <div style={{ padding: "1.2rem" }}>
              <Table withTableBorder withColumnBorders striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    {isAdmin ? <Table.Th style={{ width: 40 }} /> : null}
                    {userColumns.map((column, index) => (
                      <Table.Th key={column.key ?? `col-${index}`} style={column.width ? { width: column.width } : undefined}>
                        {column.title}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {userRows.map((row, index) => {
                    const rowId = row.user.id;
                    const selected = selectedUserIds.includes(rowId);
                    return (
                      <Table.Tr key={rowId} onDoubleClick={() => onOpenMemberDetail(rowId)}>
                        {isAdmin ? (
                          <Table.Td>
                            <Checkbox
                              checked={selected}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                const next = checked
                                  ? [...selectedUserIds, rowId]
                                  : selectedUserIds.filter((item) => item !== rowId);
                                onSelectionChange(next);
                              }}
                            />
                          </Table.Td>
                        ) : null}
                        {userColumns.map((column, colIndex) => {
                          const value = resolveDataIndex(row, column.dataIndex);
                          const content = column.render ? column.render(value, row, index) : (value as ReactNode);
                          return <Table.Td key={column.key ?? `cell-${colIndex}`}>{content}</Table.Td>;
                        })}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </div>
          </InfiniCard>
        </>
      ) : null}
    </Stack>
  );
}

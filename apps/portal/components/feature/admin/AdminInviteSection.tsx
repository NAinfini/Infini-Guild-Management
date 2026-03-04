import { Alert, Badge, Button, Group, Loader, NumberInput, SegmentedControl, Stack, Table, Text, TextInput } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import type { ReactNode } from "react";
import type { fetchAdminInviteLinks, fetchAdminInviteStats } from "../../../api/queries/admin";

type InviteRow = Awaited<ReturnType<typeof fetchAdminInviteLinks>>[number];
type InviteStats = Awaited<ReturnType<typeof fetchAdminInviteStats>>;

type AdminInviteSectionProps = {
  heading: ReactNode;
  inviteVisibility: "active" | "expired";
  onInviteVisibilityChange: (value: "active" | "expired") => void;
  isAdmin: boolean;
  inviteMaxUses: number;
  onInviteMaxUsesChange: (value: number) => void;
  inviteMaxUsesLabel: string;
  inviteExpiresAt: string;
  onInviteExpiresAtChange: (value: string) => void;
  onCreateInvite: () => void;
  inviteCreateLabel: string;
  inviteStatsLoading: boolean;
  inviteStats: InviteStats | null;
  inviteStatsTotalLabel: string;
  inviteStatsActiveLabel: string;
  inviteStatsRevokedLabel: string;
  inviteStatsExpiredLabel: string;
  inviteLinksLoading: boolean;
  inviteLinksError: boolean;
  loadErrorMessage: string;
  inviteRows: InviteRow[];
  isInviteInactive: (row: InviteRow) => boolean;
  formatDateTime: (iso: string | null) => string;
  onCopyInviteLink: (row: InviteRow) => void;
  onRevokeInvite: (row: InviteRow) => void;
  inviteCopyLabel: string;
  inviteRevokeLabel: string;
};

export function AdminInviteSection({
  heading,
  inviteVisibility,
  onInviteVisibilityChange,
  isAdmin,
  inviteMaxUses,
  onInviteMaxUsesChange,
  inviteMaxUsesLabel,
  inviteExpiresAt,
  onInviteExpiresAtChange,
  onCreateInvite,
  inviteCreateLabel,
  inviteStatsLoading,
  inviteStats,
  inviteStatsTotalLabel,
  inviteStatsActiveLabel,
  inviteStatsRevokedLabel,
  inviteStatsExpiredLabel,
  inviteLinksLoading,
  inviteLinksError,
  loadErrorMessage,
  inviteRows,
  isInviteInactive,
  formatDateTime,
  onCopyInviteLink,
  onRevokeInvite,
  inviteCopyLabel,
  inviteRevokeLabel,
}: AdminInviteSectionProps) {
  return (
    <Stack gap={12}>
      {heading}
      <InfiniCard>
        <div style={{ padding: "1.2rem" }}>
          <Group wrap="wrap" gap={8}>
            <SegmentedControl
              value={inviteVisibility}
              onChange={(value) => onInviteVisibilityChange(value as "active" | "expired")}
              data={[
                { value: "active", label: "Active" },
                { value: "expired", label: "Expired" },
              ]}
            />
            {isAdmin ? (
              <>
                <Group align="center" gap={6}>
                  <Text size="sm" c="dimmed">{inviteMaxUsesLabel}</Text>
                  <NumberInput
                    min={1}
                    value={inviteMaxUses}
                    onChange={(value) => onInviteMaxUsesChange(typeof value === "number" ? value : 1)}
                    aria-label="Invite max uses"
                    style={{ width: 120 }}
                  />
                </Group>
                <TextInput
                  type="datetime-local"
                  value={inviteExpiresAt}
                  onChange={(event) => onInviteExpiresAtChange(event.currentTarget.value)}
                  aria-label="Invite expiration time"
                />
                <Button onClick={onCreateInvite}>
                  {inviteCreateLabel}
                </Button>
              </>
            ) : null}
          </Group>
        </div>
      </InfiniCard>

      {inviteStatsLoading ? <Loader size="sm" /> : null}
      {inviteStats ? (
        <InfiniCard>
          <div style={{ padding: "1.2rem" }}>
            <Group wrap="wrap" gap={8}>
              <Badge color="blue" variant="light">
                {inviteStatsTotalLabel}: {inviteStats.total}
              </Badge>
              <Badge color="green" variant="light">
                {inviteStatsActiveLabel}: {inviteStats.active}
              </Badge>
              <Badge color="red" variant="light">
                {inviteStatsRevokedLabel}: {inviteStats.revoked}
              </Badge>
              <Badge color="yellow" variant="light">
                {inviteStatsExpiredLabel}: {inviteStats.expired}
              </Badge>
            </Group>
          </div>
        </InfiniCard>
      ) : null}

      {inviteLinksLoading ? <Loader size="sm" /> : null}
      {inviteLinksError ? <Alert color="yellow" title={loadErrorMessage} /> : null}
      {!inviteLinksLoading && !inviteLinksError ? (
        <InfiniCard>
          <div style={{ padding: "1.2rem" }}>
            <Table withTableBorder withColumnBorders striped>
              <Table.Thead>
                <Table.Tr>
                  {isAdmin ? <Table.Th>Code</Table.Th> : null}
                  <Table.Th>Usage</Table.Th>
                  {!isAdmin ? <Table.Th>Status</Table.Th> : null}
                  <Table.Th>Expires</Table.Th>
                  <Table.Th>Created</Table.Th>
                  {isAdmin ? <Table.Th>Actions</Table.Th> : null}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {inviteRows.map((row) => {
                  const expired = Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
                  const fullyUsed = row.used_count >= row.max_uses;
                  const inactive = isInviteInactive(row);
                  return (
                    <Table.Tr key={row.id}>
                      {isAdmin ? <Table.Td>{row.code}</Table.Td> : null}
                      <Table.Td>{row.used_count}/{row.max_uses}</Table.Td>
                      {!isAdmin ? (
                        <Table.Td>
                          {row.revoked_at ? (
                            <Badge color="red" variant="light">revoked</Badge>
                          ) : fullyUsed ? (
                            <Badge color="yellow" variant="light">fully used</Badge>
                          ) : expired ? (
                            <Badge color="yellow" variant="light">expired</Badge>
                          ) : (
                            <Badge color="green" variant="light">active</Badge>
                          )}
                        </Table.Td>
                      ) : null}
                      <Table.Td>{formatDateTime(row.expires_at)}</Table.Td>
                      <Table.Td>{formatDateTime(row.created_at)}</Table.Td>
                      {isAdmin ? (
                        <Table.Td>
                          <Group gap={8}>
                            <Button size="xs" onClick={() => onCopyInviteLink(row)} disabled={inactive}>
                              {inviteCopyLabel}
                            </Button>
                            <Button size="xs" color="red" disabled={inactive} onClick={() => onRevokeInvite(row)}>
                              {inviteRevokeLabel}
                            </Button>
                          </Group>
                        </Table.Td>
                      ) : null}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        </InfiniCard>
      ) : null}
    </Stack>
  );
}


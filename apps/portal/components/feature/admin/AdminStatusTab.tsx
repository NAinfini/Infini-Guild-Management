import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import type { ReactNode } from "react";
import { AdminSystemSection } from "./AdminSystemSection";

type StatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

type StatusHealthLog = {
  at: string;
  db: string;
  r2: string;
  ws: string;
  crons: string;
  latencyMs: number | null;
};

type AdminStatusTabProps = {
  heading: ReactNode;
  isAdmin: boolean;
  adminOnlyMessage: string;
  onRetry: () => void;
  retryLoading: boolean;
  onCopyConfigSummary: () => void;
  canCopyConfigSummary: boolean;
  statusLatencyMs: number | null;
  statusLoading: boolean;
  statusError: boolean;
  loadErrorMessage: string;
  statusData: StatusData | null;
  statusHealthLogs: StatusHealthLog[];
  formatDateTime: (iso: string | null) => string;
};

export function AdminStatusTab({
  heading,
  isAdmin,
  adminOnlyMessage,
  onRetry,
  retryLoading,
  onCopyConfigSummary,
  canCopyConfigSummary,
  statusLatencyMs,
  statusLoading,
  statusError,
  loadErrorMessage,
  statusData,
  statusHealthLogs,
  formatDateTime,
}: AdminStatusTabProps) {
  if (!isAdmin) {
    return (
      <Stack gap={12}>
        {heading}
        <Alert color="yellow" title={adminOnlyMessage} />
      </Stack>
    );
  }

  return (
    <Stack gap={12}>
      {heading}
      <InfiniCard>
        <Stack gap={10}>
          <Group gap={8} wrap="wrap">
            <Button onClick={onRetry} loading={retryLoading}>
              Retry
            </Button>
            <Button onClick={onCopyConfigSummary} disabled={!canCopyConfigSummary}>
              Copy config summary
            </Button>
            {statusLatencyMs !== null ? (
              <Text c="dimmed" size="sm">Latency: {statusLatencyMs}ms</Text>
            ) : null}
          </Group>
          <AdminSystemSection
            statusLoading={statusLoading}
            statusError={statusError}
            loadErrorMessage={loadErrorMessage}
            statusData={statusData}
            statusHealthLogs={statusHealthLogs}
            formatDateTime={formatDateTime}
          />
        </Stack>
      </InfiniCard>
    </Stack>
  );
}


import { Alert, Badge, Loader, Group, Stack, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { useTranslation } from "react-i18next";

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

type AdminSystemSectionProps = {
  statusLoading: boolean;
  statusError: boolean;
  loadErrorMessage: string;
  statusData: StatusData | null;
  statusHealthLogs: StatusHealthLog[];
  formatDateTime: (iso: string | null) => string;
};

export function AdminSystemSection({
  statusLoading,
  statusError,
  loadErrorMessage,
  statusData,
  statusHealthLogs,
  formatDateTime,
}: AdminSystemSectionProps) {
  const { t } = useTranslation("admin");
  return (
    <Stack gap={10}>
      {statusLoading ? <Loader size="sm" /> : null}
      {statusError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}
      {statusData ? (
        <Group gap={8} wrap="wrap">
          <Badge color={statusData.db === "ok" ? "green" : "red"} variant="light">{t("status.summary.db", { value: statusData.db })}</Badge>
          <Badge color={statusData.r2 === "ok" ? "green" : "red"} variant="light">{t("status.summary.r2", { value: statusData.r2 })}</Badge>
          <Badge color={statusData.ws === "ok" ? "green" : "yellow"} variant="light">{t("status.summary.ws", { value: statusData.ws })}</Badge>
          <Badge color={statusData.crons === "ok" ? "green" : "red"} variant="light">{t("status.summary.crons", { value: statusData.crons })}</Badge>
        </Group>
      ) : null}
      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Text fw={600} size="sm" mb={8}>{t("status.healthLogs.title")}</Text>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            <Stack gap={6}>
              {statusHealthLogs.length === 0 ? (
                <Text c="dimmed" size="sm">{t("status.healthLogs.empty")}</Text>
              ) : (
                statusHealthLogs.map((row, index) => (
                  <Text key={`${row.at}-${index}`} size="xs">
                    {formatDateTime(row.at)} | DB {row.db} | R2 {row.r2} | WS {row.ws} | Crons {row.crons} | {row.latencyMs ?? "-"}ms
                  </Text>
                ))
              )}
            </Stack>
          </div>
        </div>
      </InfiniCard>
    </Stack>
  );
}



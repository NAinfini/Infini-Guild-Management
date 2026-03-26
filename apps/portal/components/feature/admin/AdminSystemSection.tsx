import { Alert, Badge, Skeleton, Group, Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";

type StatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

type AdminSystemSectionProps = {
  statusLoading: boolean;
  statusError: boolean;
  loadErrorMessage: string;
  statusData: StatusData | null;
};

export function AdminSystemSection({
  statusLoading,
  statusError,
  loadErrorMessage,
  statusData,
}: AdminSystemSectionProps) {
  const { t } = useTranslation("admin");
  return (
    <Stack gap={10}>
      {statusLoading ? <Group gap={8}><Skeleton height={22} width={80} radius="xl" /><Skeleton height={22} width={80} radius="xl" /><Skeleton height={22} width={80} radius="xl" /><Skeleton height={22} width={80} radius="xl" /></Group> : null}
      {statusError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}
      {statusData ? (
        <Group gap={8} wrap="wrap">
          <Badge color={statusData.db === "ok" ? "green" : "red"} variant="light">{t("status.summary.db", { value: statusData.db })}</Badge>
          <Badge color={statusData.r2 === "ok" ? "green" : "red"} variant="light">{t("status.summary.r2", { value: statusData.r2 })}</Badge>
          <Badge color={statusData.ws === "ok" ? "green" : "yellow"} variant="light">{t("status.summary.ws", { value: statusData.ws })}</Badge>
          <Badge color={statusData.crons === "ok" ? "green" : "red"} variant="light">{t("status.summary.crons", { value: statusData.crons })}</Badge>
        </Group>
      ) : null}
    </Stack>
  );
}
import {
  requestAdminAuditArchiveDownload,
  downloadAdminAuditArchiveFile,
} from "../../../services/AdminService";
import { downloadFileBlob } from "../../../utils/admin";
import {
  Button,
  Collapse,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveIcon } from "@portal/components/icons";
import { notifySuccess, notifyError } from "../../../utils/notifications";
import { EmptyState } from "../../shared/EmptyState";
import { AdminLoadError } from "./AdminLoadError";

type AuditArchiveExplorerProps = {
  months: string[];
  monthsLoading: boolean;
  monthsError: boolean;
  onRetryMonths: () => void;
};

export function AuditArchiveExplorer({
  months,
  monthsLoading,
  monthsError,
  onRetryMonths,
}: AuditArchiveExplorerProps) {
  const { t } = useTranslation("admin");
  const [opened, setOpened] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const monthOptions = useMemo(() => months.map((m) => ({ value: m, label: m })), [months]);

  const handleDownload = async () => {
    if (!selectedMonth) return;
    setDownloading(true);
    try {
      const response = await requestAdminAuditArchiveDownload(selectedMonth);
      for (const file of response.files) {
        const blob = await downloadAdminAuditArchiveFile(file.url);
        const segments = file.key.split("/").filter(Boolean);
        downloadFileBlob(segments[segments.length - 1] ?? `guild-audit-${selectedMonth}.ndjson.gz`, blob);
      }
      notifySuccess(t("message.archiveRawDownloaded"));
    } catch {
      notifyError(t("message.archiveRawDownloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap={12}>
        <Group justify="space-between" align="center">
          <Group gap={8}>
            <ArchiveIcon size={18} />
            <Text fw={600}>{t("auditArchive.title")}</Text>
          </Group>
          <Button variant={opened ? "default" : "light"} size="sm" onClick={() => setOpened((v) => !v)}>
            {opened ? t("auditArchive.toggleHide") : t("auditArchive.toggleShow")}
          </Button>
        </Group>

        <Collapse expanded={opened}>
          <Stack gap={12} pt="xs">
            {monthsLoading ? <Skeleton height={36} /> : null}
            {monthsError ? <AdminLoadError onRetry={onRetryMonths} /> : null}

            {!monthsLoading && !monthsError && months.length === 0 ? (
              <EmptyState className="admin-empty" title={t("auditArchive.empty")} />
            ) : null}

            {!monthsLoading && !monthsError && months.length > 0 ? (
              <Group wrap="wrap" align="flex-end" gap={8}>
                <Select
                  label={t("auditArchive.monthLabel")}
                  placeholder={t("auditArchive.monthPlaceholder")}
                  data={monthOptions}
                  value={selectedMonth}
                  onChange={(value) => { if (value) setSelectedMonth(value); }}
                  style={{ width: 220 }}
                />
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void handleDownload()}
                  loading={downloading}
                  disabled={!selectedMonth}
                >
                  {t("auditArchive.downloadRaw")}
                </Button>
              </Group>
            ) : null}
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}

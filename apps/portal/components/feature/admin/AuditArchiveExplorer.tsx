import {
  fetchAdminAuditArchiveFiles,
  downloadAdminAuditArchiveFile,
} from "../../../services/AdminService";
import { downloadFileBlob } from "../../../utils/admin";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveIcon } from "@portal/components/icons";
import { notifySuccess } from "../../../utils/notifications";
import { presentAppError } from "../../../hooks/useAppError";
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
      const response = await fetchAdminAuditArchiveFiles(selectedMonth);
      for (const file of response.files) {
        const blob = await downloadAdminAuditArchiveFile(file.id);
        downloadFileBlob(file.filename, blob);
      }
      notifySuccess(t("message.archiveRawDownloaded"));
    } catch (error) {
      presentAppError(error, t("message.archiveRawDownloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ArchiveIcon size={18} aria-hidden="true" />
            <strong>{t("auditArchive.title")}</strong>
          </div>
          <Button
            variant={opened ? "secondary" : "ghost"}
            size="sm"
            aria-expanded={opened}
            onClick={() => setOpened((value) => !value)}
          >
            {opened ? t("auditArchive.toggleHide") : t("auditArchive.toggleShow")}
          </Button>
        </div>

        {opened ? (
          <div className="grid gap-3 border-t border-border pt-3">
            {monthsLoading ? <Skeleton className="h-9 w-full" /> : null}
            {monthsError ? <AdminLoadError onRetry={onRetryMonths} /> : null}

            {!monthsLoading && !monthsError && months.length === 0 ? (
              <EmptyState className="admin-empty" title={t("auditArchive.empty")} />
            ) : null}

            {!monthsLoading && !monthsError && months.length > 0 ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid w-[220px] gap-1.5">
                  <Label>{t("auditArchive.monthLabel")}</Label>
                  <Select
                    value={selectedMonth}
                    items={monthOptions}
                    onValueChange={(value) => setSelectedMonth(value)}
                  >
                    <SelectTrigger aria-label={t("auditArchive.monthLabel")}>
                      <SelectValue placeholder={t("auditArchive.monthPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {monthOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleDownload()}
                  loading={downloading}
                  disabled={!selectedMonth}
                >
                  {t("auditArchive.downloadRaw")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
    </Card>
  );
}

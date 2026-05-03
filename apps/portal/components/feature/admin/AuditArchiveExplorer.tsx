import type { AuditLogEntry } from "@guild/shared";
import {
  downloadAdminAuditArchiveFile,
  requestAdminAuditArchiveDownload,
} from "../../../api/queries/admin";
import { downloadFileBlob, formatAuditDiffHeader, formatDateTime } from "../../../utils/admin";
import {
  Alert,
  Button,
  Collapse,
  Group,
  Pagination,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { PortalCard } from "../../shared/PortalCard";
import {
  InfiniTable,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@portal/components/shared/InfiniTable";
import type { ColumnDef, SortingState } from "@portal/components/shared/InfiniTable";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveIcon } from "@portal/components/icons";
import { notifySuccess, notifyError, notifyWarning } from "../../../utils/notifications";

type AuditRow = AuditLogEntry;

type AuditArchiveExplorerProps = {
  months: string[];
  monthsLoading: boolean;
  monthsError: boolean;
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
  archiveLoading: boolean;
  archiveError: boolean;
  archiveRows: AuditRow[];
  archivePageCurrent: number;
  archivePageSize: number;
  archiveTotal: number;
  onArchivePageChange: (nextPage: number) => void;
};

const CSV_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function decompressGzipBlob(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === "undefined") throw new Error("decompress_failed");
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    throw new Error("decompress_failed");
  }
}

function parseNdjsonRows(text: string): AuditRow[] {
  try {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditRow);
  } catch {
    throw new Error("parse_failed");
  }
}

function buildCsvBlob(rows: AuditRow[]): Blob {
  try {
    const header = "timestamp_utc,timestamp_local,actor,action,entity_type,entity_id,diff_title,detail_text";
    const lines = rows.map((row) =>
      [
        row.created_at ?? "",
        formatDateTime(row.created_at),
        row.actor_id ?? "",
        row.action ?? "",
        row.entity_type ?? "",
        row.entity_id ?? "",
        row.diff_title ?? "",
        row.detail_text ?? "",
      ]
        .map((v) => escapeCsvField(String(v)))
        .join(","),
    );
    return new Blob(["\uFEFF", [header, ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  } catch {
    throw new Error("encode_failed");
  }
}

export function AuditArchiveExplorer({
  months,
  monthsLoading,
  monthsError,
  selectedMonth,
  onSelectMonth,
  archiveLoading,
  archiveError,
  archiveRows,
  archivePageCurrent,
  archivePageSize,
  archiveTotal,
  onArchivePageChange,
}: AuditArchiveExplorerProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const [opened, setOpened] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [downloadingFormat, setDownloadingFormat] = useState<"raw" | "csv" | null>(null);

  const totalPages = Math.max(1, Math.ceil(archiveTotal / Math.max(1, archivePageSize)));
  const monthOptions = useMemo(() => months.map((m) => ({ value: m, label: m })), [months]);

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(() => [
    { header: t("audit.table.entity"), id: "entity_type", accessorKey: "entity_type", size: 100 },
    { header: t("audit.table.action"), id: "action", accessorKey: "action", size: 100 },
    {
      header: t("audit.table.diff"), id: "diff", enableSorting: false, size: 280,
      cell: ({ row }) => (
        <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
          {formatAuditDiffHeader(row.original.diff_title, row.original.detail_text)}
        </Text>
      ),
    },
    {
      header: t("audit.table.actor"), id: "actor_id", accessorKey: "actor_id", size: 120,
      cell: ({ row }) => <Text size="sm" truncate>{row.original.actor_id}</Text>,
    },
    {
      header: t("audit.table.entityId"), id: "entity_id", accessorKey: "entity_id", size: 120,
      cell: ({ row }) => <Text size="sm" truncate>{row.original.entity_id}</Text>,
    },
    {
      header: t("audit.table.time"), id: "created_at", accessorKey: "created_at", size: 150,
      cell: ({ row }) => (
        <Text size="sm" style={{ whiteSpace: "nowrap" }}>{formatDateTime(row.original.created_at)}</Text>
      ),
    },
  ], [t]);

  const table = useReactTable({
    data: archiveRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  const handleDownloadRaw = async () => {
    if (!selectedMonth) return;
    setDownloadingFormat("raw");
    try {
      const response = await requestAdminAuditArchiveDownload(selectedMonth, "raw_ndjson_gz");
      for (const file of response.files) {
        const blob = await downloadAdminAuditArchiveFile(file.url);
        const segments = file.key.split("/").filter(Boolean);
        downloadFileBlob(segments[segments.length - 1] ?? `guild-audit-${selectedMonth}.ndjson.gz`, blob);
      }
      notifySuccess(t("message.archiveRawDownloaded"));
    } catch {
      notifyError(t("message.archiveRawDownloadFailed"));
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleDownloadCsv = async () => {
    if (!selectedMonth) return;
    setDownloadingFormat("csv");
    try {
      const response = await requestAdminAuditArchiveDownload(selectedMonth, "raw_ndjson_gz");
      const totalBytes = response.files.reduce((sum, f) => sum + f.size_bytes, 0);
      if (totalBytes > CSV_SIZE_LIMIT_BYTES) {
        notifyWarning(t("auditArchive.rawOnlyMessage"));
        setDownloadingFormat(null);
        return;
      }

      const allRows: AuditRow[] = [];
      for (const file of response.files) {
        const blob = await downloadAdminAuditArchiveFile(file.url);
        const text = await decompressGzipBlob(blob);
        allRows.push(...parseNdjsonRows(text));
      }

      const csvBlob = buildCsvBlob(allRows);
      downloadFileBlob(`guild-audit-${selectedMonth}-localtime.csv`, csvBlob);
      notifySuccess(t("message.archiveCsvExported"));
    } catch (error) {
      const key =
        error instanceof Error && error.message === "decompress_failed"
          ? "message.archiveCsvExportFailedDecompress"
          : error instanceof Error && error.message === "parse_failed"
            ? "message.archiveCsvExportFailedParse"
            : error instanceof Error && error.message === "encode_failed"
              ? "message.archiveCsvExportFailedEncode"
              : "message.archiveCsvExportFailed";
      notifyError(t(key));
    } finally {
      setDownloadingFormat(null);
    }
  };

  return (
    <PortalCard interactive={false} padding="1.2rem">
      <Stack gap={12}>
        <Group justify="space-between" align="center">
          <Group gap={8}>
            <ArchiveIcon size={18} />
            <Text fw={600}>{t("auditArchive.title")}</Text>
          </Group>
          <Button variant={opened ? "default" : "light"} size="compact-sm" onClick={() => setOpened((v) => !v)}>
            {opened ? t("auditArchive.toggleHide") : t("auditArchive.toggleShow")}
          </Button>
        </Group>

        <Collapse in={opened}>
          <Stack gap={12} pt="xs">
            {monthsLoading ? <Skeleton height={36} /> : null}
            {monthsError ? <Alert color="yellow" title={tc("loadError")} /> : null}

            {!monthsLoading && !monthsError && months.length === 0 ? (
              <Alert color="yellow">{t("auditArchive.empty")}</Alert>
            ) : null}

            {!monthsLoading && !monthsError && months.length > 0 ? (
              <>
                <Group wrap="wrap" align="flex-end" gap={8}>
                  <Select
                    label={t("auditArchive.monthLabel")}
                    placeholder={t("auditArchive.monthPlaceholder")}
                    data={monthOptions}
                    value={selectedMonth}
                    onChange={(value) => { if (value) onSelectMonth(value); }}
                    style={{ width: 220 }}
                  />
                  <Button
                    variant="default"
                    size="compact-sm"
                    onClick={() => void handleDownloadRaw()}
                    loading={downloadingFormat === "raw"}
                    disabled={!selectedMonth}
                  >
                    {t("auditArchive.downloadRaw")}
                  </Button>
                  <Button
                    variant="default"
                    size="compact-sm"
                    onClick={() => void handleDownloadCsv()}
                    loading={downloadingFormat === "csv"}
                    disabled={!selectedMonth}
                  >
                    {t("auditArchive.downloadCsv")}
                  </Button>
                </Group>

                {archiveLoading ? (
                  <Stack gap={8}>
                    <Alert color="blue" variant="light">{t("auditArchive.slowQueryHint")}</Alert>
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}
                  </Stack>
                ) : null}

                {archiveError ? <Alert color="yellow" title={tc("loadError")} /> : null}

                {!archiveLoading && !archiveError && selectedMonth && archiveRows.length > 0 ? (
                  <>
                    <ScrollArea type="auto">
                      <InfiniTable table={table} highlightOnHover />
                    </ScrollArea>
                    <Group justify="flex-end">
                      <Pagination value={archivePageCurrent} total={totalPages} onChange={onArchivePageChange} withEdges />
                    </Group>
                  </>
                ) : null}

                {!archiveLoading && !archiveError && selectedMonth && archiveRows.length === 0 ? (
                  <Text size="sm" c="dimmed">{t("auditArchive.noEntries")}</Text>
                ) : null}
              </>
            ) : null}
          </Stack>
        </Collapse>
      </Stack>
    </PortalCard>
  );
}

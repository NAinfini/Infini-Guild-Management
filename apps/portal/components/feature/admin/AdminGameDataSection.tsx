import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Collapse,
  Divider,
  Group,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { EmptyState } from "../../shared/EmptyState";
import { ArrowDownIcon, UploadIcon, RefreshCwIcon, ChevronDownIcon } from "@portal/components/icons";
import {
  fetchGameDataFull,
  fetchGameDataVersions,
  rollbackGameData,
  uploadGameData,
} from "@portal/services/GameDataService";
import { queryKeys } from "@portal/api/query-keys";
import { notifySuccess, notifyError } from "@portal/utils/notifications";
import "./AdminGameDataSection.css";

function relativeTime(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return t("gameData.relativeTime.justNow");
  if (diffMin < 60) return t("gameData.relativeTime.minutesAgo", { count: diffMin });
  if (diffHr < 24) return t("gameData.relativeTime.hoursAgo", { count: diffHr });
  return t("gameData.relativeTime.daysAgo", { count: diffDay });
}

export function AdminGameDataSection() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [jsonEditorValue, setJsonEditorValue] = useState("");
  const [jsonEditorDirty, setJsonEditorDirty] = useState(false);
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);

  // The editor and the download must round-trip the whole document, rotations
  // included — the trimmed `/api/game-data` payload would silently wipe them.
  const gameDataQuery = useQuery({
    queryKey: queryKeys.gameData.full(),
    queryFn: fetchGameDataFull,
  });

  const versionsQuery = useQuery({
    queryKey: queryKeys.gameData.versions(),
    queryFn: fetchGameDataVersions,
  });

  const uploadMutation = useMutation({
    mutationFn: uploadGameData,
    onSuccess: async () => {
      setValidationErrors([]);
      setJsonEditorDirty(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.gameData.all });
      notifySuccess(t("gameData.uploadSuccess"));
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setValidationErrors([message]);
      notifyError(t("gameData.validationError"));
    },
  });

  useEffect(() => {
    if (!gameDataQuery.data || jsonEditorDirty) return;
    setJsonEditorValue(JSON.stringify(gameDataQuery.data.data, null, 2));
  }, [gameDataQuery.data, jsonEditorDirty]);

  const rollbackMutation = useMutation({
    mutationFn: rollbackGameData,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.gameData.all });
      notifySuccess(t("gameData.rollbackSuccess"));
    },
    onError: () => {
      notifyError(t("gameData.rollbackFailed"));
    },
  });

  const handleDownload = () => {
    const data = gameDataQuery.data;
    if (!data) return;
    const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `game-data-${data.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === "string") {
        uploadMutation.mutate(text);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    event.target.value = "";
  };

  const handleEditorChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonEditorValue(event.currentTarget.value);
    setJsonEditorDirty(true);
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonEditorValue);
      setJsonEditorValue(JSON.stringify(parsed, null, 2));
      setValidationErrors([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setValidationErrors([t("gameData.invalidJson", { message })]);
    }
  };

  const handleResetJson = () => {
    const data = gameDataQuery.data;
    if (!data) return;
    setJsonEditorValue(JSON.stringify(data.data, null, 2));
    setJsonEditorDirty(false);
    setValidationErrors([]);
  };

  const handleSaveJson = () => {
    try {
      const parsed = JSON.parse(jsonEditorValue);
      uploadMutation.mutate(JSON.stringify(parsed, null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setValidationErrors([t("gameData.invalidJson", { message })]);
    }
  };

  const handleRollback = (versionId: number) => {
    modals.openConfirmModal({
      title: t("gameData.rollback"),
      children: <Text size="sm">{t("gameData.rollbackConfirm")}</Text>,
      confirmProps: { color: "red" },
      labels: { confirm: t("gameData.rollback"), cancel: t("badges.action.cancel") },
      onConfirm: () => rollbackMutation.mutate(versionId),
    });
  };

  const isLoading = gameDataQuery.isLoading;
  const hasData = gameDataQuery.data != null;
  const versions = versionsQuery.data ?? [];
  const recentVersions = versions.slice(0, 5);

  if (isLoading) {
    return (
      <Stack gap={12}>
        <Skeleton height={28} width="40%" />
        <Skeleton height={60} />
        <Skeleton height={120} />
      </Stack>
    );
  }

  if (!hasData) {
    return (
      <Stack gap={16}>
        <EmptyState title={t("gameData.empty")} />
        <Group>
          <DepthButton
            type="primary"
            onClick={() => fileInputRef.current?.click()}
            loading={uploadMutation.isPending}
          >
            <UploadIcon size={16} />
            {t("gameData.upload")}
          </DepthButton>
        </Group>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        {validationErrors.length > 0 ? (
          <Alert color="red" title={t("gameData.validationError")}>
            {validationErrors.map((err, i) => (
              <Text key={i} size="sm">{err}</Text>
            ))}
          </Alert>
        ) : null}
      </Stack>
    );
  }

  const { version, schemaVersion } = gameDataQuery.data!;
  const currentVersionEntry = recentVersions.find((v) => v.version === version);
  const currentVersionUploadedBy = currentVersionEntry?.uploaded_by_name ?? currentVersionEntry?.uploaded_by ?? "-";
  const currentVersionUpdatedAt = currentVersionEntry?.created_at ?? null;

  return (
    <Stack gap={18} className="admin-game-data">
      <Box className="admin-game-data__hero">
        <Stack gap={14}>
          <Group justify="space-between" align="flex-start" gap={16} className="admin-game-data__hero-header">
            <Stack gap={6}>
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" className="admin-game-data__eyebrow">
                {t("tab.gameData")}
              </Text>
              <Group gap={10} align="center">
                <span className="admin-game-data__status-dot" />
                <Badge variant="outline" color="gray" size="xl" className="admin-game-data__version-badge">{version}</Badge>
                <Badge variant="outline" color="gray">{t("gameData.schemaVersion")}: {schemaVersion}</Badge>
              </Group>
            </Stack>
            <Group gap={8} className="admin-game-data__actions">
              <DepthButton type="secondary" onClick={handleDownload}>
                <ArrowDownIcon size={16} />
                {t("gameData.download")}
              </DepthButton>
              <DepthButton
                type="primary"
                onClick={() => fileInputRef.current?.click()}
                loading={uploadMutation.isPending}
              >
                <UploadIcon size={16} />
                {t("gameData.upload")}
              </DepthButton>
            </Group>
          </Group>

          <div className="admin-game-data__meta-grid">
            <div className="admin-game-data__meta-item">
              <Text size="xs" c="dimmed" fw={700}>{t("gameData.currentVersion")}</Text>
              <Text size="sm" fw={600}>{version}</Text>
            </div>
            <div className="admin-game-data__meta-item">
              <Text size="xs" c="dimmed" fw={700}>{t("gameData.uploadedBy")}</Text>
              <Text size="sm" fw={600}>{currentVersionUploadedBy}</Text>
            </div>
            <div className="admin-game-data__meta-item">
              <Text size="xs" c="dimmed" fw={700}>{t("gameData.updatedAt")}</Text>
              <Text size="sm" fw={600}>
                {currentVersionUpdatedAt ? new Date(currentVersionUpdatedAt).toLocaleString() : "-"}
              </Text>
            </div>
          </div>
        </Stack>
      </Box>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />

      {validationErrors.length > 0 ? (
        <Alert color="red" title={t("gameData.validationError")}>
          {validationErrors.map((err, i) => (
            <Text key={i} size="sm">{err}</Text>
          ))}
        </Alert>
      ) : null}

      <Box className="admin-game-data__panel">
        <button
          type="button"
          className="admin-game-data__collapse-trigger"
          aria-expanded={jsonEditorOpen}
          aria-label={jsonEditorOpen ? t("gameData.hideJsonEditor") : t("gameData.showJsonEditor")}
          onClick={() => setJsonEditorOpen((open) => !open)}
        >
          <span>
            <Text fw={700}>{t("gameData.editorTitle")}</Text>
            <Text size="xs" c="dimmed">
              {t("gameData.editorMeta", { count: jsonEditorValue.length })}
              {" · "}
              {t("gameData.lineCount", { count: jsonEditorValue.split("\n").length })}
            </Text>
          </span>
          <Badge variant="light" color={jsonEditorDirty ? "orange" : "gray"}>
            {jsonEditorDirty ? t("gameData.unsaved") : t("gameData.synced")}
          </Badge>
          <span className={`admin-game-data__collapse-icon ${jsonEditorOpen ? "admin-game-data__collapse-icon--open" : ""}`}>
            <ChevronDownIcon size={14} />
          </span>
          <span className="admin-game-data__collapse-label">
            {jsonEditorOpen ? t("gameData.hideJsonEditor") : t("gameData.showJsonEditor")}
          </span>
        </button>

        <Collapse in={jsonEditorOpen}>
          {jsonEditorOpen ? (
            <>
              <Divider />
              <Stack gap={12} className="admin-game-data__editor-body">
                <Group justify="flex-end" gap={8}>
                  <DepthButton type="secondary" size="sm" onClick={handleFormatJson}>
                    {t("gameData.formatJson")}
                  </DepthButton>
                  <DepthButton type="secondary" size="sm" onClick={handleResetJson}>
                    {t("gameData.resetJson")}
                  </DepthButton>
                  <DepthButton
                    type="primary"
                    size="sm"
                    onClick={handleSaveJson}
                    loading={uploadMutation.isPending}
                  >
                    {t("gameData.saveJson")}
                  </DepthButton>
                </Group>
                <Textarea
                  aria-label={t("gameData.editorLabel")}
                  value={jsonEditorValue}
                  onChange={handleEditorChange}
                  autosize
                  minRows={18}
                  maxRows={36}
                  classNames={{ input: "admin-game-data__textarea" }}
                />
              </Stack>
            </>
          ) : null}
        </Collapse>
      </Box>

      <Stack gap={10}>
        <Group justify="space-between" align="center">
          <Text fw={700}>{t("gameData.versions")}</Text>
          <Badge variant="outline" color="gray">{recentVersions.length}</Badge>
        </Group>
        {versionsQuery.isLoading ? (
          <Skeleton height={100} />
        ) : recentVersions.length === 0 ? (
          <Text size="sm" c="dimmed">-</Text>
        ) : (
          <Table highlightOnHover className="admin-game-data__versions-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("gameData.currentVersion")}</Table.Th>
                <Table.Th>{t("gameData.uploadedBy")}</Table.Th>
                <Table.Th>{t("gameData.updatedAt")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentVersions.map((v, index) => (
                <Table.Tr
                  key={v.id}
                  className={v.version === version ? "admin-game-data__active-row" : undefined}
                >
                  <Table.Td>
                    <Group gap={8}>
                      <Badge variant="outline" color="gray" size="sm">{v.version}</Badge>
                      {index === 0 ? <Badge size="xs" color="gray" variant="light">{t("gameData.active")}</Badge> : null}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{v.uploaded_by_name ?? v.uploaded_by}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{new Date(v.created_at).toLocaleString()}</Text>
                    <span className="admin-game-data__relative-time">{relativeTime(v.created_at, t)}</span>
                  </Table.Td>
                  <Table.Td>
                    {v.version !== version ? (
                      <DepthButton
                        type="warning"
                        size="sm"
                        className="admin-game-data__rollback-btn"
                        onClick={() => handleRollback(v.id)}
                        loading={rollbackMutation.isPending}
                      >
                        <RefreshCwIcon size={14} />
                        {t("gameData.rollback")}
                      </DepthButton>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Stack>
  );
}

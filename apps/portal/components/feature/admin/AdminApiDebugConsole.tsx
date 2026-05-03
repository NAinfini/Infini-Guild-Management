import { ActionIcon, Badge, Code, Group, ScrollArea, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { PortalCard } from "../../shared/PortalCard";
import { ClipboardIcon, TrashIcon } from "@portal/components/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { type DebugLogEntry } from "./AdminApiTestEngine";

function formatLogEntry(entry: DebugLogEntry): string {
  const statusStr = entry.status !== null ? String(entry.status) : "ERR";
  const errorStr = entry.error ? ` | ERROR: ${entry.error}` : "";
  const header = `[${entry.ranAt}] ${entry.method} ${entry.path} → ${statusStr} (${entry.latencyMs}ms)${errorStr}`;
  if (!entry.body) return header;
  return `${header}\n${entry.body}`;
}

export function AdminApiDebugConsole({
  logs,
  onClear,
}: {
  logs: DebugLogEntry[];
  onClear: () => void;
}) {
  const { t } = useTranslation("admin");
  const clipboard = useClipboard();

  const copyAll = useCallback(() => {
    const text = logs.map(formatLogEntry).join("\n\n" + "─".repeat(80) + "\n\n");
    clipboard.copy(text);
  }, [logs]);

  const consoleText = logs.length === 0
    ? t("status.api.debugEmpty")
    : logs.map(formatLogEntry).join("\n\n" + "─".repeat(80) + "\n\n");

  return (
    <PortalCard interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Group justify="space-between" mb={8}>
          <Group gap={8}>
            <Text fw={600} size="sm">{t("status.api.debugTitle")}</Text>
            <Badge size="xs" variant="default">{logs.length}</Badge>
          </Group>
          <Group gap={4}>
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={copyAll}
              disabled={logs.length === 0}
              aria-label={t("status.api.copyAll")}
            >
              <ClipboardIcon size={14} />
            </ActionIcon>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              onClick={onClear}
              disabled={logs.length === 0}
              aria-label={t("status.api.clearDebug")}
            >
              <TrashIcon size={14} />
            </ActionIcon>
          </Group>
        </Group>
        <ScrollArea.Autosize mah={400}>
          <Code block style={{ fontSize: 11, whiteSpace: "pre-wrap", minHeight: 60 }}>
            {consoleText}
          </Code>
        </ScrollArea.Autosize>
      </div>
    </PortalCard>
  );
}

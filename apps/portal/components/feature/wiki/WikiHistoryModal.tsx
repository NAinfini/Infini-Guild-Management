import type { WikiArticle, WikiRevisionListItem } from "@guild/shared";
import { Badge, Group, Loader, Modal, ScrollArea, SegmentedControl, Stack, Text, UnstyledButton } from "@mantine/core";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { useWikiHistory, type WikiHistoryDiffBlock } from "../../../hooks/useWikiHistory";
import { useConfirmDialog } from "../../shared/ConfirmDialog";
import { DepthButton } from "../../shared/DepthButton";
import { EmptyState } from "../../shared/EmptyState";

const CONTEXT_PREVIEW_LINES = 2;

function collapseContext(text: string, ellipsis: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length <= CONTEXT_PREVIEW_LINES * 2 + 1) return text;
  return [...lines.slice(0, CONTEXT_PREVIEW_LINES), ellipsis, ...lines.slice(-CONTEXT_PREVIEW_LINES)].join("\n");
}

const DIFF_TEXT_STYLE: React.CSSProperties = { whiteSpace: "pre-wrap", wordBreak: "break-word" };
const ADDED_STYLE: React.CSSProperties = { backgroundColor: "var(--mantine-color-green-light)" };
const REMOVED_STYLE: React.CSSProperties = { backgroundColor: "var(--mantine-color-red-light)", textDecoration: "line-through" };

function DiffView({ blocks, ellipsis }: { blocks: WikiHistoryDiffBlock[]; ellipsis: string }) {
  return (
    <Stack gap={2}>
      {blocks.map((block, index) => {
        if (block.kind === "modified") {
          return (
            <Text key={index} size="sm" style={DIFF_TEXT_STYLE}>
              {block.parts.map((part, partIndex) => (
                <span key={partIndex} style={part.added ? ADDED_STYLE : part.removed ? REMOVED_STYLE : undefined}>
                  {part.value}
                </span>
              ))}
            </Text>
          );
        }
        if (block.kind === "context") {
          return (
            <Text key={index} size="sm" c="dimmed" style={DIFF_TEXT_STYLE}>
              {collapseContext(block.text, ellipsis)}
            </Text>
          );
        }
        return (
          <Text key={index} size="sm" style={{ ...DIFF_TEXT_STYLE, ...(block.kind === "added" ? ADDED_STYLE : REMOVED_STYLE) }}>
            {block.text}
          </Text>
        );
      })}
    </Stack>
  );
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

type WikiHistoryModalProps = {
  opened: boolean;
  onClose: () => void;
  article: WikiArticle;
};

export function WikiHistoryModal({ opened, onClose, article }: WikiHistoryModalProps) {
  const { t } = useTranslation("wiki");
  const history = useWikiHistory({ article, opened, onClose });
  const confirm = useConfirmDialog();

  const handleRestore = async (revision: number) => {
    const accepted = await confirm({
      title: t("history.confirmRestore.title"),
      description: <Text size="sm">{t("history.confirmRestore.description", { revision })}</Text>,
      cancelLabel: t("common:action.cancel"),
      confirmLabel: t("history.restore"),
      intent: "danger",
    });
    if (accepted) history.restore(revision);
  };

  const renderRevisionRow = (revision: WikiRevisionListItem) => (
    <UnstyledButton
      key={revision.id}
      onClick={() => history.setSelectedRevision(revision.revision)}
      className={`wiki-history-revision-row${revision.revision === history.selectedRevision ? " wiki-history-revision-row--selected" : ""}`}
    >
      <Group gap={8} wrap="nowrap" justify="space-between">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600}>
              {t("history.revisionLabel", { revision: revision.revision })}
            </Text>
            {revision.revision === history.latestRevisionNumber ? (
              <Badge size="xs" variant="light">
                {t("history.latest")}
              </Badge>
            ) : null}
            {revision.restored_from !== null ? (
              <Badge size="xs" variant="light" color="orange">
                {t("history.restoredFrom", { revision: revision.restored_from })}
              </Badge>
            ) : null}
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {t("history.editedBy", { user: revision.edited_by_username ?? revision.edited_by.slice(0, 8), date: formatDateTime(revision.created_at) })}
          </Text>
        </Stack>
      </Group>
    </UnstyledButton>
  );

  return (
    <Modal opened={opened} onClose={onClose} title={t("history.title")} size="xl" centered>
      <Stack gap={12}>
        {history.isListLoading ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        ) : history.revisions.length === 0 ? (
          <EmptyState title={t("history.empty.title")} description={t("history.empty.description")} />
        ) : (
          <>
            <ScrollArea.Autosize mah={220} type="auto">
              <Stack gap={2}>{history.revisions.map(renderRevisionRow)}</Stack>
            </ScrollArea.Autosize>

            <Group justify="space-between" wrap="wrap" gap={8}>
              <SegmentedControl
                value={history.compareMode}
                onChange={(value) => history.setCompareMode(value as "current" | "previous")}
                data={[
                  { value: "current", label: t("history.compareCurrent") },
                  { value: "previous", label: t("history.comparePrevious"), disabled: history.previousRevisionNumber === null },
                ]}
                size="xs"
              />
              {history.selectedRevision !== null ? (
                <DepthButton
                  type="secondary"
                  size="sm"
                  disabled={history.isIdenticalToCurrent || history.isRestoring}
                  onClick={() => handleRestore(history.selectedRevision!)}
                >
                  {history.isRestoring ? t("history.restoring") : t("history.restore")}
                </DepthButton>
              ) : null}
            </Group>

            {history.isDiffLoading ? (
              <Group justify="center" p="md">
                <Loader size="sm" />
              </Group>
            ) : history.compareMode === "previous" && history.previousRevisionNumber === null ? (
              <Text size="sm" c="dimmed">
                {t("history.noPrevious")}
              </Text>
            ) : history.diff ? (
              <ScrollArea.Autosize mah={360} type="auto">
                <Stack gap={8}>
                  {history.diff.titleChanged ? (
                    <Text size="sm" style={DIFF_TEXT_STYLE}>
                      <span style={REMOVED_STYLE}>{history.diff.oldTitle}</span> <span style={ADDED_STYLE}>{history.diff.newTitle}</span>
                    </Text>
                  ) : null}
                  {history.hasChanges ? (
                    <DiffView blocks={history.diff.blocks} ellipsis={t("history.contextEllipsis")} />
                  ) : (
                    <Text size="sm" c="dimmed">
                      {t("history.noChanges")}
                    </Text>
                  )}
                </Stack>
              </ScrollArea.Autosize>
            ) : null}
          </>
        )}
      </Stack>
    </Modal>
  );
}

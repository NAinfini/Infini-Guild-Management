import type { WikiArticle, WikiRevisionListItem } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useWikiHistory, type WikiHistoryDiffBlock } from "../../../hooks/useWikiHistory";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { ScrollArea } from "../../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import { XIcon } from "../../icons";
import { EmptyState } from "../../shared/EmptyState";

const CONTEXT_PREVIEW_LINES = 2;

function collapseContext(text: string, ellipsis: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length <= CONTEXT_PREVIEW_LINES * 2 + 1) return text;
  return [...lines.slice(0, CONTEXT_PREVIEW_LINES), ellipsis, ...lines.slice(-CONTEXT_PREVIEW_LINES)].join("\n");
}

function DiffView({ blocks, ellipsis }: { blocks: WikiHistoryDiffBlock[]; ellipsis: string }) {
  return (
    <div className="wiki-history-diff-lines">
      {blocks.map((block, index) => {
        if (block.kind === "modified") {
          return (
            <p key={index} className="wiki-history-diff-line">
              {block.parts.map((part, partIndex) => (
                <span
                  key={partIndex}
                  className={part.added ? "wiki-history-diff-added" : part.removed ? "wiki-history-diff-removed" : undefined}
                >
                  {part.value}
                </span>
              ))}
            </p>
          );
        }
        if (block.kind === "context") {
          return (
            <p key={index} className="wiki-history-diff-line wiki-history-diff-context">
              {collapseContext(block.text, ellipsis)}
            </p>
          );
        }
        return (
          <p
            key={index}
            className={`wiki-history-diff-line ${block.kind === "added" ? "wiki-history-diff-added" : "wiki-history-diff-removed"}`}
          >
            {block.text}
          </p>
        );
      })}
    </div>
  );
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
      description: (
        <p className="wiki-confirmation-copy">
          {t("history.confirmRestore.description", { revision })}
        </p>
      ),
      cancelLabel: t("common:action.cancel"),
      confirmLabel: t("history.restore"),
      intent: "danger",
    });
    if (accepted) history.restore(revision);
  };

  const renderRevisionRow = (revision: WikiRevisionListItem) => (
    <button
      key={revision.id}
      type="button"
      onClick={() => history.setSelectedRevision(revision.revision)}
      aria-current={revision.revision === history.selectedRevision ? "true" : undefined}
      className={`wiki-history-revision-row${revision.revision === history.selectedRevision ? " wiki-history-revision-row--selected" : ""}`}
    >
      <span className="wiki-history-revision-row__content">
        <span className="wiki-history-revision-row__heading">
          <span>{t("history.revisionLabel", { revision: revision.revision })}</span>
          {revision.revision === history.latestRevisionNumber ? (
            <Badge variant="secondary">{t("history.latest")}</Badge>
          ) : null}
          {revision.restored_from !== null ? (
            <Badge variant="outline" className="wiki-history-revision-row__restored">
              {t("history.restoredFrom", { revision: revision.restored_from })}
            </Badge>
          ) : null}
        </span>
        <span className="wiki-muted-copy wiki-history-revision-row__meta">
          {t("history.editedBy", {
            user: revision.edited_by_display_name ?? revision.edited_by.slice(0, 8),
            date: formatDateTimeWithTimeZone(revision.created_at),
          })}
        </span>
      </span>
    </button>
  );

  const renderLoading = () => (
    <div className="wiki-history-loading" role="status">
      <IconLoader2 className="wiki-history-loading__icon" aria-hidden="true" />
      <span className="sr-only">{t("common:message.loading")}</span>
    </div>
  );

  const renderDiff = () => {
    if (history.isDiffLoading) return renderLoading();
    if (history.compareMode === "previous" && history.previousRevisionNumber === null) {
      return <p className="wiki-muted-copy">{t("history.noPrevious")}</p>;
    }
    if (!history.diff) return null;
    return (
      <ScrollArea className="wiki-history-diff-scroll">
        <div className="wiki-history-diff">
          {history.diff.titleChanged ? (
            <p className="wiki-history-diff-line">
              <span className="wiki-history-diff-removed">{history.diff.oldTitle}</span>{" "}
              <span className="wiki-history-diff-added">{history.diff.newTitle}</span>
            </p>
          ) : null}
          {history.hasChanges ? (
            <DiffView blocks={history.diff.blocks} ellipsis={t("history.contextEllipsis")} />
          ) : (
            <p className="wiki-muted-copy">{t("history.noChanges")}</p>
          )}
        </div>
      </ScrollArea>
    );
  };

  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="wiki-history-dialog" showCloseButton={false}>
        <DialogHeader className="wiki-history-dialog__header">
          <DialogTitle>{t("history.title")}</DialogTitle>
          <DialogClose
            aria-label={t("common:action.close")}
            render={<Button type="button" variant="ghost" size="icon-lg" className="wiki-history-dialog__close" />}
          >
            <XIcon size={18} aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        {history.isListLoading ? (
          renderLoading()
        ) : history.revisions.length === 0 ? (
          <EmptyState title={t("history.empty.title")} description={t("history.empty.description")} />
        ) : (
          <div className="wiki-history-dialog__body">
            <ScrollArea className="wiki-history-revisions-scroll">
              <div className="wiki-history-revisions-list">{history.revisions.map(renderRevisionRow)}</div>
            </ScrollArea>

            <Tabs
              value={history.compareMode}
              onValueChange={(value) => history.setCompareMode(value as "current" | "previous")}
              className="wiki-history-compare"
            >
              <div className="wiki-history-compare__actions">
                <TabsList aria-label={t("history.title")}>
                  <TabsTrigger value="current">{t("history.compareCurrent")}</TabsTrigger>
                  <TabsTrigger value="previous" disabled={history.previousRevisionNumber === null}>
                    {t("history.comparePrevious")}
                  </TabsTrigger>
                </TabsList>
                {history.selectedRevision !== null ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={history.isRestoring}
                    disabled={history.isIdenticalToCurrent || history.isRestoring}
                    onClick={() => handleRestore(history.selectedRevision!)}
                  >
                    {history.isRestoring ? t("history.restoring") : t("history.restore")}
                  </Button>
                ) : null}
              </div>
              <TabsContent value={history.compareMode} className="wiki-history-compare__content">
                {renderDiff()}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import type { WikiArticle, WikiRevisionListItem } from "@guild/shared";
import { useMemo } from "react";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { useTranslation } from "react-i18next";
import { useWikiHistory, type WikiHistoryDiffBlock } from "../../../hooks/useWikiHistory";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { ScrollArea } from "../../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import { XIcon } from "../../icons";
import { EmptyState } from "../../shared/EmptyState";
import { TipTapEditor } from "../../shared/TipTapEditor";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";

const CONTEXT_PREVIEW_LINES = 2;

function collapseContext(text: string, ellipsis: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length <= CONTEXT_PREVIEW_LINES * 2 + 1) return text;
  return [...lines.slice(0, CONTEXT_PREVIEW_LINES), ellipsis, ...lines.slice(-CONTEXT_PREVIEW_LINES)].join("\n");
}

function DiffView({ blocks, ellipsis }: { blocks: readonly WikiHistoryDiffBlock[]; ellipsis: string }) {
  return (
    <div className="wiki-history-diff-lines">
      {blocks.map((block, index) => {
        if (block.kind === "modified") {
          return (
            <p key={index} className="wiki-history-diff-line">
              {block.parts.map((part, partIndex) => (
                part.added ? <ins key={partIndex} className="wiki-history-diff-added">{part.value}</ins>
                  : part.removed ? <del key={partIndex} className="wiki-history-diff-removed">{part.value}</del>
                    : <span key={partIndex}>{part.value}</span>
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
            {block.kind === "added" ? <ins>{block.text}</ins> : <del>{block.text}</del>}
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
  const widthGroups = useMemo(() => {
    type WidthChange = NonNullable<typeof history.diff>["columnWidthChanges"][number];
    const groups = new Map<string, WidthChange & { count: number }>();
    for (const change of history.diff?.columnWidthChanges ?? []) {
      const key = JSON.stringify([change.table, change.column, change.before, change.after]);
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { ...change, count: 1 });
    }
    return [...groups.values()];
  }, [history.diff]);

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
    <Button
      key={revision.id}
      type="button"
      variant="ghost"
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
    </Button>
  );

  const renderLoading = () => (
    <LoadingIndicator />
  );

  const renderError = (retry: () => unknown) => (
    <EmptyState
      status="error"
      title={t("history.loadFailed")}
      actions={<Button type="button" variant="outline" onClick={() => { void retry(); }}>{t("common:action.retry")}</Button>}
    />
  );

  const formatWidths = (widths: readonly number[] | null) => widths
    ? widths.map((width) => width === 0 ? t("history.autoWidth") : `${width}px`).join(" / ")
    : t("history.autoWidth");

  const renderDiff = () => {
    if (history.isDiffLoading) return renderLoading();
    if (history.diffError) return renderError(history.retryDiff);
    if (history.compareMode === "previous" && history.previousRevisionNumber === null) {
      return <p className="wiki-muted-copy">{t("history.noPrevious")}</p>;
    }
    if (!history.diff) return null;
    const { diff } = history;
    const beforeRevision = history.compareMode === "current" ? history.selectedRevision : history.previousRevisionNumber;
    const afterRevision = history.compareMode === "current" ? t("history.current") : t("history.revisionLabel", { revision: history.selectedRevision });
    const textChanged = diff.titleChanged || diff.blocks.some((block) => block.kind !== "context");
    return (
      <ScrollArea className="wiki-history-diff-scroll">
        <div className="wiki-history-diff">
          <section className="wiki-history-summary" aria-label={t("history.changes")}>
            <h3>{history.hasChanges ? t("history.changes") : t("history.noChanges")}</h3>
            {diff.formatChanged ? <p>{t(textChanged ? "history.formatChanged" : "history.formatOnly")}</p> : null}
            {diff.columnWidthChanges.length > 0 ? (
              <ul className="wiki-history-width-changes">
                {widthGroups.map((change) => (
                  <li key={`${change.table}-${change.row}-${change.column}`}>
                    <span>{t(change.count > 1 ? "history.columnWidthGroup" : "history.columnWidth", { table: change.table + 1, row: change.row + 1, column: change.column + 1, count: change.count })}</span>
                    <span className="wiki-history-width-change__values">
                      <span>{formatWidths(change.before)}</span>
                      <span aria-label={t("history.changedTo")}> → </span>
                      <strong>{formatWidths(change.after)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          {textChanged ? (
            <section className="wiki-history-text-changes" aria-label={t("history.textChanges")}>
              <div className="wiki-history-text-changes__heading">
                <h3>{t("history.textChanges")}</h3>
                <span className="wiki-history-diff-legend">
                  <span data-kind="removed">− {t("history.removed")}</span>
                  <span data-kind="added">+ {t("history.added")}</span>
                </span>
              </div>
              {diff.titleChanged ? (
                <p className="wiki-history-diff-line">
                  <del className="wiki-history-diff-removed">{diff.oldTitle}</del>{" "}
                  <ins className="wiki-history-diff-added">{diff.newTitle}</ins>
                </p>
              ) : null}
              <DiffView blocks={diff.blocks} ellipsis={t("history.contextEllipsis")} />
            </section>
          ) : null}
          {history.hasChanges ? (
            <div className="wiki-history-previews">
              <section className="wiki-history-preview">
                <header><h3>{t("history.before")}</h3><span>{t("history.revisionLabel", { revision: beforeRevision })}</span></header>
                <div className="wiki-history-preview__document" tabIndex={0} aria-label={t("history.before")} role="region">
                  <h4>{diff.oldTitle}</h4>
                  <TipTapEditor value={diff.oldBody} onChange={() => {}} readOnly showTableOfContents={false} />
                </div>
              </section>
              <section className="wiki-history-preview">
                <header><h3>{t("history.after")}</h3><span>{afterRevision}</span></header>
                <div className="wiki-history-preview__document" tabIndex={0} aria-label={t("history.after")} role="region">
                  <h4>{diff.newTitle}</h4>
                  <TipTapEditor value={diff.newBody} onChange={() => {}} readOnly showTableOfContents={false} />
                </div>
              </section>
            </div>
          ) : (
            <section className="wiki-history-preview">
              <header><h3>{afterRevision}</h3></header>
              <div className="wiki-history-preview__document" tabIndex={0} aria-label={afterRevision} role="region">
                <h4>{diff.newTitle}</h4>
                <TipTapEditor value={diff.newBody} onChange={() => {}} readOnly showTableOfContents={false} />
              </div>
            </section>
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
          <DialogDescription className="wiki-history-dialog__description">{article.title}</DialogDescription>
          <DialogClose
            aria-label={t("common:action.close")}
            render={<Button type="button" variant="ghost" size="icon-lg" className="wiki-history-dialog__close" />}
          >
            <XIcon size={18} aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        {history.isListLoading ? (
          renderLoading()
        ) : history.listError ? (
          renderError(history.retryList)
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
                <TabsList variant="line" aria-label={t("history.title")}>
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
                    disabled={history.isIdenticalToCurrent || history.isRestoring || history.isDiffLoading || history.diffError}
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

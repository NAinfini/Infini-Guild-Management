import type { WikiArticle, WikiCategory } from "@guild/shared";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import { TipTapEditor } from "@portal/components/shared/TipTapEditor";
import { PlusIcon, SaveIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { Switch } from "@portal/components/ui/switch";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import type { ReactNode } from "react";
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";
import { EmptyState } from "../../shared/EmptyState";

type CategoryOption = {
  value: string;
  label: string;
};

type WikiArticleEditorCardProps = {
  navigation: ReactNode;
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  isCreatingArticle: boolean;
  selectedArticle: WikiArticle | null;
  selectedCategory: WikiCategory | null;
  isLoading: boolean;
  articleTitle: string;
  articleBody: string;
  articleCategoryId: string;
  categoryOptions: CategoryOption[];
  pinnedIntent: "none" | "pin" | "unpin";
  archiveIntent: "none" | "archive" | "unarchive";
  isSaving: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isArchiving: boolean;
  canCreateArticle: boolean;
  onArticleTitleChange: (value: string) => void;
  onArticleBodyChange: (value: string) => void;
  onArticleCategoryChange: (value: string) => void;
  onSaveArticle: () => void;
  onTogglePinnedIntent: () => void;
  onToggleArchiveIntent: () => void;
  onCreateArticle: () => void;
  onExitEditor: () => void;
  onImageUpload: (file: File) => Promise<string>;
  onDeleteArticle: () => void;
  emptyTitle: ReactNode;
};

export function WikiArticleEditorCard({
  navigation,
  canCreate,
  canEdit,
  canArchive,
  canDelete,
  isCreatingArticle,
  selectedArticle,
  selectedCategory,
  isLoading,
  articleTitle,
  articleBody,
  articleCategoryId,
  categoryOptions,
  pinnedIntent,
  archiveIntent,
  isSaving,
  isCreating,
  isDeleting,
  isArchiving,
  canCreateArticle,
  onArticleTitleChange,
  onArticleBodyChange,
  onArticleCategoryChange,
  onSaveArticle,
  onTogglePinnedIntent,
  onToggleArchiveIntent,
  onCreateArticle,
  onExitEditor,
  onImageUpload,
  onDeleteArticle,
  emptyTitle,
}: WikiArticleEditorCardProps) {
  const { t } = useTranslation("wiki");
  const { t: te } = useTranslation("editor");
  const editorLabels = useMemo(() => buildTipTapEditorLabels(te), [te]);
  const titleId = useId();
  const categoryId = useId();
  const pinIntentLabel = pinnedIntent === "pin"
    ? t("articleEditor.pinQueued")
    : pinnedIntent === "unpin"
      ? t("articleEditor.unpinQueued")
      : null;
  const archiveIntentLabel = archiveIntent === "archive"
    ? t("articleEditor.archiveQueued")
    : archiveIntent === "unarchive"
      ? t("articleEditor.unarchiveQueued")
      : null;
  const pinnedPressed = selectedArticle
    ? (selectedArticle.pinned ? pinnedIntent !== "unpin" : pinnedIntent === "pin")
    : false;
  const archivePressed = selectedArticle
    ? (selectedArticle.archived_at ? archiveIntent !== "unarchive" : archiveIntent === "archive")
    : false;
  const editorBusy = isSaving || isCreating || isDeleting || isArchiving;
  const canUseEditor = canEdit || (canCreate && isCreatingArticle);

  if (!selectedArticle && !canUseEditor) {
    return (
      <Card className="wiki-article-editor-card">
        <div className="wiki-card-body">
          <div className="wiki-detail-navigation">{navigation}</div>
          <h2 className="wiki-article-editor-title">{t("articleEditor.title")}</h2>
          <EmptyState title={emptyTitle} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="wiki-article-editor-card">
      <div className="wiki-card-body">
        <div className="wiki-detail-navigation">{navigation}</div>
        <header className="wiki-article-editor-header">
          <h2 className="wiki-article-editor-title">{t("articleEditor.title")}</h2>
          {canUseEditor ? (
            <div className="wiki-article-editor-actions">
              {selectedArticle ? (
                <>
                  <div className="wiki-article-editor-toggles">
                    <div className="wiki-editor-toggle">
                      <span className="wiki-editor-toggle__copy">
                        <strong>{t("articleEditor.pin")}</strong>
                        {pinIntentLabel ? <small aria-live="polite">{pinIntentLabel}</small> : null}
                      </span>
                      <Switch
                        checked={pinnedPressed}
                        onCheckedChange={onTogglePinnedIntent}
                        disabled={editorBusy}
                        aria-label={t("articleEditor.pin")}
                      />
                    </div>
                    {canArchive ? (
                      <div className="wiki-editor-toggle">
                        <span className="wiki-editor-toggle__copy">
                          <strong>{t("articleEditor.archive")}</strong>
                          {archiveIntentLabel ? <small aria-live="polite">{archiveIntentLabel}</small> : null}
                        </span>
                        <Switch
                          checked={archivePressed}
                          onCheckedChange={onToggleArchiveIntent}
                          disabled={editorBusy}
                          aria-label={t("articleEditor.archive")}
                        />
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    loading={isSaving}
                    onClick={() => {
                      if (!articleTitle.trim()) {
                        notifyError(t("validation.titleRequired"));
                        return;
                      }
                      onSaveArticle();
                    }}
                    disabled={editorBusy}
                  >
                    <SaveIcon size={16} aria-hidden="true" />
                    {t("articleEditor.save")}
                  </Button>
                </>
              ) : null}
              {canCreate && isCreatingArticle ? (
                <Button
                  type="button"
                  size="sm"
                  loading={isCreating}
                  onClick={onCreateArticle}
                  disabled={!canCreateArticle || isCreating}
                >
                  <PlusIcon size={16} aria-hidden="true" />
                  {t("articleEditor.create")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onExitEditor}
                disabled={editorBusy}
              >
                <XIcon size={16} aria-hidden="true" />
                {t("editor.exit")}
              </Button>
              {selectedArticle && canDelete ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="wiki-article-editor-actions__danger"
                  onClick={onDeleteArticle}
                  loading={isDeleting}
                  disabled={editorBusy}
                >
                  <TrashIcon size={16} aria-hidden="true" />
                  {t("common:action.delete")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className="wiki-card-scroll wiki-article-editor-scroll">
          {isLoading ? (
            <LoadingIndicator />
          ) : null}
          {!isLoading ? (
            <div className="wiki-editor-form">
              <div className="wiki-editor-fields">
                <div className="wiki-editor-field wiki-editor-field--title">
                  <Label htmlFor={titleId}>{t("articleEditor.titleField")}</Label>
                  <Input
                    id={titleId}
                    value={articleTitle}
                    disabled={!canUseEditor || editorBusy}
                    onChange={(event) => onArticleTitleChange(event.currentTarget.value)}
                    placeholder={t("articleEditor.titleField")}
                    aria-label={t("aria.articleTitle")}
                    className="wiki-editor-title-input"
                  />
                </div>
                <div className="wiki-editor-field wiki-editor-field--category">
                  <Label htmlFor={categoryId}>{t("articleEditor.category")}</Label>
                  <Select
                    items={categoryOptions}
                    value={articleCategoryId || null}
                    disabled={!canUseEditor || editorBusy}
                    onValueChange={(value) => onArticleCategoryChange(value ?? "")}
                  >
                    <SelectTrigger id={categoryId} aria-label={t("aria.articleCategory")}>
                      <SelectValue placeholder={t("articleEditor.category")} />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {categoryOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="wiki-editor-field wiki-editor-composer">
                <span className="wiki-editor-field__label">{t("articleEditor.body")}</span>
                <TipTapEditor
                  value={articleBody}
                  onChange={onArticleBodyChange}
                  placeholder={t("articleEditor.body")}
                  editable={canUseEditor && !editorBusy}
                  ariaLabel={t("articleEditor.body")}
                  onImageUpload={onImageUpload}
                  labels={editorLabels}
                />
              </div>
              {selectedArticle ? (
                <div className="wiki-editor-metadata">
                  <nav className="wiki-article-breadcrumb" aria-label={t("aria.breadcrumb")}>
                    <span>{t("articleEditor.title")}</span>
                    <span aria-hidden="true" className="wiki-muted-copy">/</span>
                    <span>{selectedCategory?.name ?? t("articleEditor.categoryFallback")}</span>
                    <span aria-hidden="true" className="wiki-muted-copy">/</span>
                    <span>{selectedArticle.title}</span>
                  </nav>
                  <p className="wiki-muted-copy wiki-article-reader-meta">
                    {t("articleEditor.lastUpdatedBy", {
                      user:
                        selectedArticle.updated_by_display_name ??
                        selectedArticle.created_by.slice(0, 8),
                      date: formatDateTimeWithTimeZone(selectedArticle.updated_at),
                    })}
                  </p>
                  {selectedArticle.archived_at ? (
                    <p className="wiki-muted-copy wiki-article-reader-meta">
                      {t("articleEditor.archivedAt", {
                        date: formatDateTimeWithTimeZone(selectedArticle.archived_at),
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

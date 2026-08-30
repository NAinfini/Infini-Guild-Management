import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PlusIcon, SaveIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import type { WikiCategoryDraft } from "@portal/types/wiki";
import { verticalDragTransform } from "@portal/utils/sortable-transform";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

type WikiCategoryEditorCardProps = {
  navigation: ReactNode;
  canEdit: boolean;
  categoryDrafts: WikiCategoryDraft[];
  isCreating: boolean;
  isSavingDrafts: boolean;
  canSaveDrafts: boolean;
  canRunDirectCommands: boolean;
  deletingCategoryId: string | null;
  onCreateCategory: () => void;
  onSaveDrafts: () => void;
  onCloseEditor: () => void;
  onCategoryDraftNameChange: (categoryId: string, value: string) => void;
  onCategoryMove: (categoryId: string, overCategoryId: string) => void;
  onDeleteCategory: (categoryId: string) => void;
};

function SortableCategoryRow({
  draft,
  canEdit,
  canRunDirectCommands,
  deletingCategoryId,
  onCategoryDraftNameChange,
  onDeleteCategory,
}: {
  draft: WikiCategoryDraft;
  canEdit: boolean;
  canRunDirectCommands: boolean;
  deletingCategoryId: string | null;
  onCategoryDraftNameChange: (categoryId: string, value: string) => void;
  onDeleteCategory: (categoryId: string) => void;
}) {
  const { t } = useTranslation("wiki");
  const categoryNameId = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: draft.id,
    disabled: !canEdit,
  });
  const style = {
    transform: verticalDragTransform(transform),
    transition,
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`wiki-category-editor-row${isDragging ? " wiki-category-editor-row--dragging" : ""}`}
    >
      <div className="wiki-category-editor-row__content">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="wiki-category-editor-row__drag-handle"
          aria-label={t("categoryEditor.dragHandle")}
          disabled={!canEdit}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={20} aria-hidden="true" />
        </Button>
        <div className="wiki-category-editor-row__field">
          <Label htmlFor={categoryNameId}>{t("categoryEditor.name")}</Label>
          <Input
            id={categoryNameId}
            value={draft.name}
            disabled={!canEdit}
            onChange={(event) => onCategoryDraftNameChange(draft.id, event.currentTarget.value)}
            aria-label={t("aria.categoryName")}
          />
        </div>
        <div className="wiki-category-editor-row__actions">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onDeleteCategory(draft.id)}
            loading={deletingCategoryId === draft.id}
            disabled={!canRunDirectCommands || Boolean(deletingCategoryId && deletingCategoryId !== draft.id)}
          >
            <TrashIcon size={16} aria-hidden="true" />
            {t("categoryEditor.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WikiCategoryEditorCard({
  navigation,
  canEdit,
  categoryDrafts,
  isCreating,
  isSavingDrafts,
  canSaveDrafts,
  canRunDirectCommands,
  deletingCategoryId,
  onCreateCategory,
  onSaveDrafts,
  onCloseEditor,
  onCategoryDraftNameChange,
  onCategoryMove,
  onDeleteCategory,
}: WikiCategoryEditorCardProps) {
  const { t } = useTranslation("wiki");
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!canEdit) return null;

  return (
    <Card className="wiki-category-editor-card">
      <div className="wiki-card-body">
        <div className="wiki-detail-navigation">{navigation}</div>
        <header className="wiki-card-header wiki-category-editor-header">
          <h2 className="wiki-card-title">{t("categoryEditor.title")}</h2>
          <div className="wiki-category-editor-header__actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCreateCategory}
              loading={isCreating}
              disabled={!canRunDirectCommands}
            >
              <PlusIcon size={14} aria-hidden="true" />
              {t("categoryEditor.create")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSaveDrafts}
              loading={isSavingDrafts}
              disabled={!canSaveDrafts || isCreating}
            >
              <SaveIcon size={14} aria-hidden="true" />
              {t("articleEditor.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCloseEditor}
              disabled={isSavingDrafts || isCreating}
            >
              <XIcon size={14} aria-hidden="true" />
              {t("editor.closeNoSave")}
            </Button>
          </div>
        </header>

        <div className="wiki-card-scroll wiki-category-editor-scroll">
          <div className="wiki-category-editor-list-heading">
            <span>{t("categoryEditor.listTitle")}</span>
            <span>{t("categoryEditor.reorderHint")}</span>
          </div>
          {categoryDrafts.length === 0 ? (
            <p className="wiki-muted-copy">{t("categoryEditor.empty")}</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                if (event.over) onCategoryMove(String(event.active.id), String(event.over.id));
              }}
            >
              <SortableContext
                items={categoryDrafts.map((draft) => draft.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="wiki-category-editor-tree">
                  {categoryDrafts.map((draft) => (
                    <SortableCategoryRow
                      key={draft.id}
                      draft={draft}
                      canEdit={canEdit}
                      canRunDirectCommands={canRunDirectCommands}
                      deletingCategoryId={deletingCategoryId}
                      onCategoryDraftNameChange={onCategoryDraftNameChange}
                      onDeleteCategory={onDeleteCategory}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </Card>
  );
}

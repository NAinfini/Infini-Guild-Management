import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SaveIcon,
  TrashIcon,
  XIcon,
} from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import type { WikiCategoryDraft } from "@portal/types/wiki";
import { verticalDragTransform } from "@portal/utils/sortable-transform";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CATEGORY_INDENT_WIDTH,
  flattenCategoryDrafts,
  getIndentMove,
  getOutdentMove,
  projectCategoryMove,
  type CategoryMove,
} from "@portal/utils/wiki-category-tree";

type WikiCategoryEditorCardProps = {
  canEdit: boolean;
  categoryDrafts: WikiCategoryDraft[];
  isCreating: boolean;
  isSavingDrafts: boolean;
  canSaveDrafts: boolean;
  deletingCategoryId: string | null;
  onCreateCategory: () => void;
  onSaveDrafts: () => void;
  onCloseEditor: () => void;
  onCategoryDraftNameChange: (categoryId: string, value: string) => void;
  onCategoryMove: (categoryId: string, move: CategoryMove) => void;
  onDeleteCategory: (categoryId: string) => void;
};

function SortableCategoryRow({
  draft,
  depth,
  canEdit,
  deletingCategoryId,
  indentMove,
  outdentMove,
  onCategoryDraftNameChange,
  onCategoryMove,
  onDeleteCategory,
}: {
  draft: WikiCategoryDraft;
  depth: number;
  canEdit: boolean;
  deletingCategoryId: string | null;
  indentMove: CategoryMove | null;
  outdentMove: CategoryMove | null;
  onCategoryDraftNameChange: (categoryId: string, value: string) => void;
  onCategoryMove: (categoryId: string, move: CategoryMove) => void;
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
    "--wiki-category-depth": depth,
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
            variant="outline"
            size="icon-sm"
            aria-label={t("categoryEditor.outdent")}
            disabled={!canEdit || !outdentMove}
            onClick={() => outdentMove && onCategoryMove(draft.id, outdentMove)}
          >
            <ChevronLeftIcon size={14} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("categoryEditor.indent")}
            disabled={!canEdit || !indentMove}
            onClick={() => indentMove && onCategoryMove(draft.id, indentMove)}
          >
            <ChevronRightIcon size={14} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onDeleteCategory(draft.id)}
            loading={deletingCategoryId === draft.id}
            disabled={Boolean(deletingCategoryId && deletingCategoryId !== draft.id)}
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
  canEdit,
  categoryDrafts,
  isCreating,
  isSavingDrafts,
  canSaveDrafts,
  deletingCategoryId,
  onCreateCategory,
  onSaveDrafts,
  onCloseEditor,
  onCategoryDraftNameChange,
  onCategoryMove,
  onDeleteCategory,
}: WikiCategoryEditorCardProps) {
  const { t } = useTranslation("wiki");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const flat = useMemo(() => flattenCategoryDrafts(categoryDrafts), [categoryDrafts]);
  const visibleItems = useMemo(
    () => (activeId ? flat.filter((entry) => entry.parentId !== activeId) : flat),
    [activeId, flat],
  );
  const projected = useMemo(
    () =>
      activeId && overId
        ? projectCategoryMove({
            items: visibleItems,
            activeId,
            overId,
            offsetX,
            indentWidth: CATEGORY_INDENT_WIDTH,
          })
        : null,
    [activeId, offsetX, overId, visibleItems],
  );
  const levelMoves = useMemo(
    () =>
      new Map(
        categoryDrafts.map((draft) => [
          draft.id,
          { indent: getIndentMove(categoryDrafts, draft.id), outdent: getOutdentMove(categoryDrafts, draft.id) },
        ]),
      ),
    [categoryDrafts],
  );

  if (!canEdit) return null;

  const resetDrag = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  return (
    <Card className="wiki-category-editor-card">
      <div className="wiki-card-body">
        <header className="wiki-card-header wiki-category-editor-header">
          <h2 className="wiki-card-title">{t("categoryEditor.title")}</h2>
          <div className="wiki-category-editor-header__actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCreateCategory}
              loading={isCreating}
              disabled={isSavingDrafts}
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
              onDragStart={(event: DragStartEvent) => {
                setActiveId(String(event.active.id));
                setOverId(String(event.active.id));
                setOffsetX(0);
              }}
              onDragMove={(event: DragMoveEvent) => setOffsetX(event.delta.x)}
              onDragOver={(event: DragOverEvent) => setOverId(event.over ? String(event.over.id) : null)}
              onDragEnd={(event: DragEndEvent) => {
                if (projected) onCategoryMove(String(event.active.id), projected);
                resetDrag();
              }}
              onDragCancel={resetDrag}
            >
              <SortableContext
                items={visibleItems.map((entry) => entry.draft.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="wiki-category-editor-tree">
                  {visibleItems.map((entry) => (
                    <SortableCategoryRow
                      key={entry.draft.id}
                      draft={entry.draft}
                      depth={
                        entry.draft.id === activeId && projected
                          ? (projected.parentId ? 1 : 0)
                          : entry.depth
                      }
                      canEdit={canEdit}
                      deletingCategoryId={deletingCategoryId}
                      indentMove={levelMoves.get(entry.draft.id)?.indent ?? null}
                      outdentMove={levelMoves.get(entry.draft.id)?.outdent ?? null}
                      onCategoryDraftNameChange={onCategoryDraftNameChange}
                      onCategoryMove={onCategoryMove}
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

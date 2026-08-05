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
import { CSS } from "@dnd-kit/utilities";
import { ActionIcon, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SaveIcon,
  TrashIcon,
  XIcon,
} from "@portal/components/icons";
import { IconGripVertical } from "@tabler/icons-react";
import type { WikiCategoryDraft } from "@portal/types/wiki";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CATEGORY_INDENT_WIDTH,
  flattenCategoryDrafts,
  getIndentMove,
  getOutdentMove,
  projectCategoryMove,
  type CategoryMove,
} from "@portal/utils/wiki-category-tree";

/*
 * The editable list is the category tree: vertical movement reorders siblings
 * and horizontal movement changes depth. Tree projection clamps invalid depth;
 * keyboard users reorder through dnd-kit and change depth with arrow actions.
 */

type WikiCategoryEditorCardProps = {
  canEdit: boolean;
  categoryName: string;
  categoryDrafts: WikiCategoryDraft[];
  isCreating: boolean;
  isSavingDrafts: boolean;
  canSaveDrafts: boolean;
  deletingCategoryId: string | null;
  onCategoryNameChange: (value: string) => void;
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: draft.id,
    disabled: !canEdit,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    "--wiki-category-depth": depth,
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`wiki-category-editor-row${isDragging ? " wiki-category-editor-row--dragging" : ""}`}
    >
      <Group gap={8} wrap="nowrap" align="end">
        <ActionIcon
          variant="default"
          aria-label={t("categoryEditor.dragHandle")}
          disabled={!canEdit}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} />
        </ActionIcon>
        <div
          className={`wiki-floating-field${draft.name.trim().length > 0 ? " wiki-floating-field--filled" : ""}`}
          style={{ flex: 1, minWidth: 220 }}
        >
          <TextInput
            classNames={{
              root: "wiki-floating-root",
              input: "wiki-floating-input",
              label: "wiki-floating-label",
            }}
            label={t("categoryEditor.name")}
            value={draft.name}
            disabled={!canEdit}
            onChange={(event) => onCategoryDraftNameChange(draft.id, event.currentTarget.value)}
          />
        </div>
        <ActionIcon
          variant="default"
          aria-label={t("categoryEditor.outdent")}
          disabled={!canEdit || !outdentMove}
          onClick={() => outdentMove && onCategoryMove(draft.id, outdentMove)}
        >
          <ChevronLeftIcon size={14} />
        </ActionIcon>
        <ActionIcon
          variant="default"
          aria-label={t("categoryEditor.indent")}
          disabled={!canEdit || !indentMove}
          onClick={() => indentMove && onCategoryMove(draft.id, indentMove)}
        >
          <ChevronRightIcon size={14} />
        </ActionIcon>
        <Button
          size="sm"
          variant="light"
          color="red"
          leftSection={<TrashIcon size={16} />}
          onClick={() => onDeleteCategory(draft.id)}
          loading={deletingCategoryId === draft.id}
          disabled={Boolean(deletingCategoryId && deletingCategoryId !== draft.id)}
        >
          {t("categoryEditor.delete")}
        </Button>
      </Group>
    </div>
  );
}

export function WikiCategoryEditorCard({
  canEdit,
  categoryName,
  categoryDrafts,
  isCreating,
  isSavingDrafts,
  canSaveDrafts,
  deletingCategoryId,
  onCategoryNameChange,
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

  /* 拖顶层时把它的子级从列表里收起来：它们跟着爹一起走，不该自己占一个落点。 */
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

  if (!canEdit) {
    return null;
  }

  const resetDrag = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  return (
    <Paper withBorder radius="md" p="var(--card-padding)" className="wiki-category-editor-card">
      {/* 保存/放弃和「新建分类」钉在卡头，只有分类树本身内滚——分类多起来时这两组控件
          不能跟着滚走。 */}
      <div className="wiki-card-body">
          <Group justify="space-between" align="center" wrap="wrap">
            <Text fw={700}>{t("categoryEditor.title")}</Text>
            <Group gap={8}>
              <Button
                size="sm"
                leftSection={<SaveIcon size={14} />}
                onClick={onSaveDrafts}
                disabled={!canSaveDrafts || isSavingDrafts}
              >
                {t("articleEditor.save")}
              </Button>
              <Button
                variant="default"
                size="sm"
                leftSection={<XIcon size={14} />}
                onClick={onCloseEditor}
                disabled={isSavingDrafts}
              >
                {t("editor.closeNoSave")}
              </Button>
            </Group>
          </Group>

          <Group gap={8} align="end" wrap="wrap">
            <div
              className={`wiki-floating-field${categoryName.trim().length > 0 ? " wiki-floating-field--filled" : ""}`}
              style={{ flex: 1, minWidth: 240 }}
            >
              <TextInput
                classNames={{
                  root: "wiki-floating-root",
                  input: "wiki-floating-input",
                  label: "wiki-floating-label",
                }}
                label={t("categoryEditor.name")}
                value={categoryName}
                onChange={(event) => onCategoryNameChange(event.currentTarget.value)}
                aria-label={t("aria.categoryName")}
              />
            </div>
            <Button
              size="sm"
              leftSection={<PlusIcon size={14} />}
              onClick={onCreateCategory}
              disabled={categoryName.trim().length === 0 || isCreating}
            >
              {t("categoryEditor.create")}
            </Button>
          </Group>

          <Stack gap={8} className="wiki-card-scroll">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text fw={600} size="sm">
                {t("categoryEditor.listTitle")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("categoryEditor.reorderHint")}
              </Text>
            </Group>
            {categoryDrafts.length === 0 ? (
              <Text c="dimmed" size="sm">
                {t("categoryEditor.empty")}
              </Text>
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
                  if (projected) {
                    onCategoryMove(String(event.active.id), projected);
                  }
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
                        /* 正在拖的那一行按投影出来的层级缩进，手上就能看出会落到第几层。 */
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
          </Stack>
      </div>
    </Paper>
  );
}

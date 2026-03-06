import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DepthButton, InfiniCard } from "@infini-dev-kit/frontend/components";
import { ActionIcon, Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconDeviceFloppy, IconGripVertical, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type WikiCategoryDraft = {
  id: string;
  name: string;
  slug: string;
  parent_id: string;
  sort_order: number;
};

type CategoryTreeNode = {
  id: string;
  name: string;
  children: CategoryTreeNode[];
};

function buildCategoryTree(drafts: WikiCategoryDraft[]): CategoryTreeNode[] {
  if (drafts.length === 0) {
    return [];
  }

  const sortedDrafts = [...drafts].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  const idSet = new Set(sortedDrafts.map((draft) => draft.id));
  const nodeById = new Map<string, CategoryTreeNode>(
    sortedDrafts.map((draft) => [
      draft.id,
      {
        id: draft.id,
        name: draft.name,
        children: [],
      },
    ]),
  );

  const roots: CategoryTreeNode[] = [];
  for (const draft of sortedDrafts) {
    const node = nodeById.get(draft.id);
    if (!node) {
      continue;
    }
    const parentId = draft.parent_id?.trim();
    if (!parentId || !idSet.has(parentId) || parentId === draft.id) {
      roots.push(node);
      continue;
    }
    const parentNode = nodeById.get(parentId);
    if (!parentNode) {
      roots.push(node);
      continue;
    }
    parentNode.children.push(node);
  }

  if (roots.length > 0) {
    return roots;
  }

  // Fallback for unexpected cyclic graphs: still render all nodes as roots.
  return sortedDrafts.map((draft) => nodeById.get(draft.id)).filter((node): node is CategoryTreeNode => Boolean(node));
}

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
  onCategoryDraftParentIdChange: (categoryId: string, value: string) => void;
  onCategoryReorder: (activeId: string, overId: string) => void;
  onDeleteCategory: (categoryId: string) => void;
};

function SortableCategoryRow({
  draft,
  canEdit,
  deletingCategoryId,
  hasChildren,
  parentOptions,
  onCategoryDraftNameChange,
  onCategoryDraftParentIdChange,
  onDeleteCategory,
}: {
  draft: WikiCategoryDraft;
  canEdit: boolean;
  deletingCategoryId: string | null;
  hasChildren: boolean;
  parentOptions: Array<{ value: string; label: string }>;
  onCategoryDraftNameChange: (categoryId: string, value: string) => void;
  onCategoryDraftParentIdChange: (categoryId: string, value: string) => void;
  onDeleteCategory: (categoryId: string) => void;
}) {
  const { t } = useTranslation("wiki");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: draft.id,
    disabled: !canEdit,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Stack gap={6}>
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
          <div
            className={`wiki-floating-field${draft.parent_id ? " wiki-floating-field--filled" : ""}`}
            style={{ width: 220 }}
          >
            <Select
              clearable
              classNames={{
                root: "wiki-floating-root",
                input: "wiki-floating-input",
                label: "wiki-floating-label",
              }}
              label={t("categoryEditor.parent")}
              data={parentOptions}
              value={draft.parent_id || null}
              disabled={!canEdit || hasChildren}
              onChange={(value) => onCategoryDraftParentIdChange(draft.id, value ?? "")}
            />
          </div>
          <Button
            size="sm"
            variant="light"
            color="infini-danger"
            leftSection={<IconTrash size={16} />}
            onClick={() => onDeleteCategory(draft.id)}
            loading={deletingCategoryId === draft.id}
            disabled={Boolean(deletingCategoryId && deletingCategoryId !== draft.id)}
          >
            {t("categoryEditor.delete")}
          </Button>
        </Group>
      </Stack>
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
  onCategoryDraftParentIdChange,
  onCategoryReorder,
  onDeleteCategory,
}: WikiCategoryEditorCardProps) {
  const { t } = useTranslation("wiki");

  if (!canEdit) {
    return null;
  }

  const childParentSet = useMemo(() => {
    const next = new Set<string>();
    for (const category of categoryDrafts) {
      if (category.parent_id) {
        next.add(category.parent_id);
      }
    }
    return next;
  }, [categoryDrafts]);

  const parentOptionsById = useMemo(() => {
    const roots = categoryDrafts.filter((category) => !category.parent_id);
    return Object.fromEntries(
      categoryDrafts.map((category) => [
        category.id,
        roots
          .filter((root) => root.id !== category.id)
          .map((root) => ({ value: root.id, label: root.name })),
      ]),
    ) as Record<string, Array<{ value: string; label: string }>>;
  }, [categoryDrafts]);

  const categoryTree = useMemo(() => buildCategoryTree(categoryDrafts), [categoryDrafts]);

  const renderCategoryTree = (nodes: CategoryTreeNode[], root = false): ReactNode => (
    <ul className={`wiki-category-diagram-list${root ? " wiki-category-diagram-list--root" : ""}`}>
      {nodes.map((node) => (
        <li key={node.id} className="wiki-category-diagram-item">
          <div className="wiki-category-diagram-node">
            <Text size="sm">{node.name || t("categoryEditor.defaultName")}</Text>
          </div>
          {node.children.length > 0 ? renderCategoryTree(node.children) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <InfiniCard interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          <Group justify="space-between" align="center" wrap="wrap">
            <Text fw={700}>{t("categoryEditor.title")}</Text>
            <Group gap={8}>
              <DepthButton
                type="primary"
                size="sm"
                before={<IconDeviceFloppy size={14} />}
                onClick={onSaveDrafts}
                disabled={!canSaveDrafts || isSavingDrafts}
              >
                {t("articleEditor.save")}
              </DepthButton>
              <DepthButton
                type="secondary"
                size="sm"
                before={<IconX size={14} />}
                onClick={onCloseEditor}
                disabled={isSavingDrafts}
              >
                {t("editor.closeNoSave")}
              </DepthButton>
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
                aria-label="Wiki category name"
              />
            </div>
            <DepthButton
              type="primary"
              size="sm"
              before={<IconPlus size={14} />}
              onClick={onCreateCategory}
              disabled={categoryName.trim().length === 0 || isCreating}
            >
              {t("categoryEditor.create")}
            </DepthButton>
          </Group>

          <Stack gap={8}>
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
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  if (!event.over) {
                    return;
                  }
                  const activeId = String(event.active.id);
                  const overId = String(event.over.id);
                  if (activeId === overId) {
                    return;
                  }
                  onCategoryReorder(activeId, overId);
                }}
              >
                <SortableContext
                  items={categoryDrafts.map((category) => category.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Stack gap={10}>
                    {categoryDrafts.map((category) => (
                      <SortableCategoryRow
                        key={category.id}
                        draft={category}
                        canEdit={canEdit}
                        deletingCategoryId={deletingCategoryId}
                        hasChildren={childParentSet.has(category.id)}
                        parentOptions={parentOptionsById[category.id] ?? []}
                        onCategoryDraftNameChange={onCategoryDraftNameChange}
                        onCategoryDraftParentIdChange={onCategoryDraftParentIdChange}
                        onDeleteCategory={onDeleteCategory}
                      />
                    ))}
                  </Stack>
                </SortableContext>
              </DndContext>
            )}
          </Stack>

          <Stack gap={8}>
            <Text fw={600} size="sm">
              {t("categoryEditor.treeDiagram")}
            </Text>
            <div className="wiki-category-diagram-panel">
              {categoryTree.length > 0 ? (
                renderCategoryTree(categoryTree, true)
              ) : (
                <Text c="dimmed" size="sm">
                  {t("categoryEditor.treeEmpty")}
                </Text>
              )}
            </div>
          </Stack>
        </Stack>
      </div>
    </InfiniCard>
  );
}

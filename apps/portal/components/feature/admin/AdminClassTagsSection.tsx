import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
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
import { LIMITS, type ClassTag } from "@guild/shared";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { PencilIcon, PlusIcon, SaveIcon, TrashIcon } from "@portal/components/icons";
import { useAdminClassTagsController } from "@portal/hooks/useAdminClassTagsController";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { IconGripVertical } from "@tabler/icons-react";
import { verticalDragTransform } from "@portal/utils/sortable-transform";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "../../shared/ClassIcon";
import { PickList, PickListFrame, PickListStaticRow } from "../../shared/PickList";
import { EmptyState } from "../../shared/EmptyState";
import "./AdminClassTagsSection.css";

const MAX_MEMBERS = LIMITS.content.classesPerTag.max;

/* 标签允许为空或相互重叠；标签顺序由左栏拖拽决定，并控制活动卡配额排列。 */

/* 编辑按钮与拖拽手柄是兄弟控件，避免嵌套按钮并将拖拽限定在手柄。 */
function SortableTagRow({
  tag,
  active,
  disabled,
  onOpen,
}: {
  tag: ClassTag;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation("admin");
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag.id, disabled });
  const style: CSSProperties = {
    transform: verticalDragTransform(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`admin-md__row ${active ? "admin-md__row--active" : ""}`}
    >
      <UnstyledButton
        className={`admin-md__item ${active ? "admin-md__item--active" : ""}`}
        onClick={onOpen}
      >
        <span className="admin-md__item-main">
          <Text size="sm" fw={500} truncate>{tag.label}</Text>
        </span>
        <span className="admin-md__item-meta">
          <Badge size="xs" variant="light" color="gray">
            {tag.class_ids.length}
          </Badge>
        </span>
      </UnstyledButton>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="admin-md__grip"
        aria-label={t("classTags.aria.dragHandle", { name: tag.label })}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <IconGripVertical size={14} />
      </button>
    </div>
  );
}

/* 单一 PickList 按职业目录排序，勾选表示成员关系，行尾标签标示重叠归属。 */

export function AdminClassTagsSection() {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const controller = useAdminClassTagsController();
  const { draft } = controller;
  const catalog = useClassCatalog();
  /* 保留服务端或乐观更新提供的顺序，避免未确认的 sort_order 覆盖拖拽结果。 */
  const tags = controller.query.data;
  const existing = draft.id ? tags?.find((tag) => tag.id === draft.id) ?? null : null;

  const [query, setQuery] = useState("");

  const picked = useMemo(() => new Set(draft.classIds), [draft.classIds]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return keyword.length === 0
      ? catalog
      : catalog.filter((item) => item.label.toLowerCase().includes(keyword));
  }, [catalog, query]);

  /* 每个职业还在哪些别的标签里。当前这个标签排除掉——它的答案是行首那个勾选框，
     再在行尾重复一遍只会让人以为是两件事。正在编辑的那个标签读的是草稿，不是
     服务端那份，所以按 draft.id 排除而不是按 tag 内容比。 */
  const otherTagsByClass = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const tag of tags ?? []) {
      if (tag.id === draft.id) continue;
      for (const classId of tag.class_ids) {
        const labels = map.get(classId);
        if (labels) labels.push(tag.label);
        else map.set(classId, [tag.label]);
      }
    }
    return map;
  }, [tags, draft.id]);

  /* 查看态列的是「装进来的那几个」，按目录顺序，不按点选先后。 */
  const pickedItems = useMemo(() => catalog.filter((item) => picked.has(item.id)), [catalog, picked]);

  const memberOptions = useMemo(() => visible.map((item) => {
    const otherTags = otherTagsByClass.get(item.id) ?? [];
    return {
      id: item.id,
      label: item.label,
      icon: <ClassIcon item={item} size={20} label={item.label} />,
      meta: otherTags.length > 0
        ? otherTags.map((label) => (
          <Badge key={label} size="xs" variant="light" color="gray">{label}</Badge>
        ))
        : undefined,
    };
  }), [visible, otherTagsByClass]);

  /*
   * 勾选只改本地草稿，得点保存才落库——而左栏拖拽是即时落库的。同一页两种提交语义，
   * 不标出来的话，改完几个勾直接切到下一个标签就白改了。
   */
  const dirty = useMemo(() => {
    if (!existing) return draft.label.trim().length > 0 || draft.classIds.length > 0;
    if (existing.label !== draft.label) return true;
    if (existing.class_ids.length !== draft.classIds.length) return true;
    return existing.class_ids.some((id) => !picked.has(id));
  }, [existing, draft.label, draft.classIds.length, picked]);

  const canSave = draft.label.trim().length > 0 && draft.classIds.length <= MAX_MEMBERS && dirty;

  /* 键盘也要能排：只有指针传感器的话，手柄能聚焦却按不动，那是个假的可访问控件。 */
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    controller.reorder(String(event.active.id), String(event.over.id));
  };

  const handleDelete = async (tag: ClassTag) => {
    const accepted = await confirm({
      title: t("classTags.confirmDelete.title"),
      /* 删标签会连同正在用它的配额格一起删掉，所以这句话必须报出有多少格在用。
         报 0 的时候也照样说，「没有活动在用」本身就是管理员想确认的事。 */
      description: t("classTags.confirmDelete.description", {
        name: tag.label,
        count: tag.usage_count,
      }),
      confirmLabel: t("classTags.action.delete"),
      cancelLabel: tc("action.cancel"),
      intent: "danger",
    });
    if (accepted) await controller.remove(tag.id);
  };

  return (
    <div className="admin-panel admin-md">
      <div className="admin-md__master">
        <div className="admin-md__master-head">
          <Group gap={8} justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text fw={700} size="sm">{t("classTags.title")}</Text>
              <Text size="xs" c="dimmed">{t("classTags.count", { count: tags?.length ?? 0 })}</Text>
            </div>
            <ActionIcon
              size="sm"
              variant="filled"
              color="portal-brand"
              onClick={controller.openCreate}
              aria-label={t("classTags.action.create")}
            >
              <PlusIcon size={14} />
            </ActionIcon>
          </Group>
        </div>

        <ScrollArea className="admin-md__list" type="auto" scrollbarSize={6}>
          <Stack gap={2} p={6}>
            {controller.query.isLoading ? (
              Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} height={40} radius="md" />)
            ) : controller.query.isError ? (
              <EmptyState
                status="error"
                title={tc("loadError")}
                actions={(
                  <Button variant="default" size="sm" onClick={() => void controller.query.refetch()}>
                    {tc("action.retry")}
                  </Button>
                )}
              />
            ) : tags?.length === 0 ? (
              <EmptyState
                title={t("classTags.empty.title")}
                description={t("classTags.empty.description")}
                actions={(
                  <Button size="sm" onClick={controller.openCreate}>{t("classTags.action.create")}</Button>
                )}
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                /* 键盘排序必须持续重新测量，理由跟职业目录那份一样（AdminClassesSection）。 */
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={(tags ?? []).map((tag) => tag.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {tags?.map((tag) => (
                    <SortableTagRow
                      key={tag.id}
                      tag={tag}
                      active={controller.opened && draft.id === tag.id}
                      // Serialize reorders so a late response cannot restore stale order.
                      disabled={controller.reorderPending}
                      onOpen={() => controller.selectTag(tag)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </Stack>
        </ScrollArea>
      </div>

      <div className="admin-md__detail">
        {controller.opened ? (
          <>
            <div className="admin-md__detail-head">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Group gap={8} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text fw={700} size="sm" truncate>
                    {controller.editing
                      ? (draft.id ? t("classTags.editTitle") : t("classTags.createTitle"))
                      : draft.label}
                  </Text>
                  {controller.editing && dirty ? (
                    <Badge size="xs" variant="light" color="yellow">{t("classTags.dirty")}</Badge>
                  ) : null}
                </Group>
                <Group gap={6} wrap="nowrap">
                  {existing && !controller.editing ? (
                    <Tooltip label={t("classTags.editTitle")} withArrow>
                      <ActionIcon
                        size={44}
                        variant="subtle"
                        onClick={controller.startEdit}
                        aria-label={t("classTags.editTitle")}
                      >
                        <PencilIcon size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                  {existing ? (
                    <Tooltip label={t("classTags.action.delete")} withArrow>
                      <ActionIcon
                        size={44}
                        variant="subtle"
                        color="red"
                        onClick={() => void handleDelete(existing)}
                        loading={controller.deletePending}
                        aria-label={t("classTags.action.delete")}
                      >
                        <TrashIcon size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                </Group>
              </Group>
            </div>

            {/* 这里没有外层滚动区。表单只有一个输入框和一个穿梭框，而穿梭框两栏
                自己就在滚——外面再套一层的话，同一片区域有两条滚动轴，滚轮落在哪
                条上取决于指针停在哪，是个套娃陷阱。去掉之后穿梭框还能把整块剩余
                高度吃下来，不用再猜一个固定的 16rem。 */}
            <div className="admin-md__detail-body admin-class-tags__body">
              {controller.editing ? (
              <TextInput
                className="admin-class-tags__name-field"
                label={t("classTags.field.label")}
                value={draft.label}
                maxLength={LIMITS.content.classTagLabel.max}
                onChange={(event) => {
                  /* 先当场取值：setDraft 的 updater 是 React 之后才调用的，
                     那时 event.currentTarget 已经是 null。 */
                  const { value } = event.currentTarget;
                  controller.setDraft((current) => ({ ...current, label: value }));
                }}
                required
              />
              ) : null}

              <div className="admin-class-tags__members">
                <div className="admin-class-tags__members-intro">
                  <Text size="sm" fw={600}>{t("classTags.field.members")}</Text>
                  {controller.editing ? (
                    <Text size="xs" c="dimmed">
                      {t("classTags.field.membersDescription", { max: MAX_MEMBERS })}
                    </Text>
                  ) : null}
                </div>

                {!controller.editing ? (
                  pickedItems.length === 0 ? (
                    <Text size="xs" c="dimmed">{t("classTags.members.none")}</Text>
                  ) : (
                    <div className="admin-class-tags__picker">
                      <PickListFrame>
                        {pickedItems.map((item) => (
                          <PickListStaticRow
                            key={item.id}
                            icon={<ClassIcon item={item} size={20} label={item.label} />}
                            label={<Text size="sm">{item.label}</Text>}
                            meta={(otherTagsByClass.get(item.id) ?? []).map((label) => (
                              <Badge key={label} size="xs" variant="light" color="gray">{label}</Badge>
                            ))}
                          />
                        ))}
                      </PickListFrame>
                    </div>
                  )
                ) : catalog.length === 0 ? (
                  <Text size="xs" c="dimmed">{t("classTags.noClasses")}</Text>
                ) : (
                  <PickList
                    className="admin-class-tags__picker"
                    size="xs"
                    aria-label={t("classTags.field.members")}
                    options={memberOptions}
                    selected={picked}
                    onToggle={controller.toggleClass}
                    emptyLabel={t("classTags.members.noMatch")}
                    max={MAX_MEMBERS}
                    search={{
                      value: query,
                      onChange: setQuery,
                      placeholder: t("classTags.members.searchPlaceholder"),
                    }}
                  />
                )}
              </div>

              {existing ? (
                <Text className="admin-class-tags__usage" size="xs" c="dimmed">
                  {t("classTags.usage", { count: existing.usage_count })}
                </Text>
              ) : null}
            </div>

            {/* Keep edit actions reachable while the member list scrolls. */}
            {controller.editing ? (
              <div className="admin-md__detail-foot">
                <Group justify="flex-end" gap={8} ml="auto">
                  <Button variant="default" onClick={controller.cancelEdit}>
                    {tc("action.cancel")}
                  </Button>
                  <Button
                    leftSection={<SaveIcon size={16} />}
                    onClick={controller.save}
                    loading={controller.savePending}
                    disabled={!canSave}
                  >
                    {t("classTags.action.save")}
                  </Button>
                </Group>
              </div>
            ) : null}
          </>
        ) : (
          <div className="admin-md__empty">
            <EmptyState title={t("classTags.selectHint")} description={t("classTags.description")} />
          </div>
        )}
      </div>
    </div>
  );
}

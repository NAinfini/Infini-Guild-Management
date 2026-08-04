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
import { CSS } from "@dnd-kit/utilities";
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
import { useClassCatalogStore } from "@portal/stores/class-catalog";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "../../shared/ClassIcon";
import { PickList, PickListFrame, PickListStaticRow } from "../../shared/PickList";
import { EmptyState } from "../../shared/EmptyState";
import "./AdminClassTagsSection.css";

const MAX_MEMBERS = LIMITS.content.classesPerTag.max;

/*
 * 职业标签的管理界面，跟职业目录共用 .admin-md 主从台。
 *
 * 标签里装什么一律不设限：空标签、跟别的标签重叠、装下整个目录都放行——哪些职业算
 * 「治疗」是公会自己的判断（见 apps/shared/schemas/class-tag.ts 里同一条说明）。所以
 * 这个界面上不会出现任何「这样组不合理」的提示，唯一的硬上限是一个标签最多装几个职业。
 *
 * 顺序跟职业目录一样靠左栏拖拽，不再有那个数字输入框（详见 useAdminClassTagsController
 * 里 ClassTagDraft 上的说明）。标签顺序决定活动卡上配额格的排列。
 */

/*
 * 清单行 = 「点开编辑」按钮 + 右侧拖拽手柄，跟 AdminClassesSection 的 SortableClassRow
 * 是同一个形状。手柄单独拆出来的理由也一样：整行可拖时，想点开编辑却把指针挪了两像素
 * 就会被判成一次拖拽。按钮不能嵌按钮，所以外面多一层 div。
 */
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
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="admin-class-tags__row">
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
        className="admin-class-tags__grip"
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

/*
 * 成员清单换过两轮。最早是「整个职业目录铺成一张网格，选中的描个边」，一眼看不出选了
 * 哪些；于是拆成可选／已选两栏的穿梭框，但一个只有十来个职业的目录被摊成两栏两个搜索框，
 * 屏幕上大半是空的，而「这个职业还在别的哪些标签里」两栏都答不上来——那才是多对多关系
 * 下最容易出错的地方（同一个职业进了两个标签，配额算的是两笔）。
 *
 * 现在是一栏勾选清单（shared/PickList）：勾选框回答「在不在这个标签里」，行尾的芯片
 * 回答「它还在哪些标签里」。清单按目录顺序渲染，不按点选先后——点选序会让刚勾上的职业
 * 跳到末尾，下次打开又排回来，看着像被人改过。
 */

export function AdminClassTagsSection() {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const controller = useAdminClassTagsController();
  const { draft } = controller;
  const catalog = useClassCatalogStore((state) => state.items);
  /* 不在这里再 sort 一遍：服务端已经按 sort_order 排好，而拖拽是乐观更新——本地按
     sort_order 重排会拿还没回来的旧数字把刚拖出来的顺序推回去。 */
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

  const atLimit = draft.classIds.length >= MAX_MEMBERS;

  /* 批量按钮只作用于当前可见的那些行：搜索「破竹」再点全选，人要的是那三个，
     不是整个目录。没搜索时可见即全部，跟直觉一致。 */
  const visibleSelectedCount = visible.reduce((sum, item) => sum + (picked.has(item.id) ? 1 : 0), 0);

  const selectVisible = () => controller.setDraft((current) => {
    const next = new Set(current.classIds);
    for (const item of visible) {
      if (next.has(item.id)) continue;
      if (next.size >= MAX_MEMBERS) break;
      next.add(item.id);
    }
    return { ...current, classIds: [...next] };
  });

  const clearVisible = () => controller.setDraft((current) => {
    const drop = new Set(visible.map((item) => item.id));
    return { ...current, classIds: current.classIds.filter((id) => !drop.has(id)) };
  });

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
    <div className="admin-md">
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
                      /* 上一次重排还在飞时不允许再拖：两个 PATCH 并发时先发的可能后到，
                         onSuccess 会把旧顺序写回缓存。 */
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
                  {/* 查看态标题就是标签自己的名字；进了编辑态才换成「编辑标签」，
                      那时名字已经在下面的输入框里了，标题再重复一遍是废话。 */}
                  <Text fw={700} size="sm" truncate>
                    {controller.editing
                      ? (draft.id ? t("classTags.editTitle") : t("classTags.createTitle"))
                      : draft.label}
                  </Text>
                  {controller.editing && dirty ? (
                    <Badge size="xs" variant="light" color="yellow">{t("classTags.dirty")}</Badge>
                  ) : null}
                </Group>
                {/* size={44} 是 19788bf「improve tablet accessibility」定的触控靶面。 */}
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
                  <Group gap={8} align="center" wrap="nowrap">
                    <Text size="sm" fw={600}>{t("classTags.field.members")}</Text>
                    <Badge size="xs" variant="light" color="gray">
                      {t("classTags.members.counter", {
                        count: draft.classIds.length,
                        total: catalog.length,
                      })}
                    </Badge>
                  </Group>
                  {controller.editing ? (
                    <Text size="xs" c="dimmed">
                      {t("classTags.field.membersDescription", { max: MAX_MEMBERS })}
                    </Text>
                  ) : null}
                </div>

                {!controller.editing ? (
                  /* 查看态：只列装进来的那几个职业，同一套行（PickListStaticRow），
                     所以点了编辑之后行不会跳。 */
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
                  /* 清单自己滚：高度跟着内容走、到 320px 才滚。原先它是 flex:1 吃满
                     剩余高度的，十个职业占着能放二十行的地方。 */
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
                    bulk={{
                      selectAll: {
                        label: t("classTags.members.selectAll"),
                        /* 满了就不给加，而不是让人点完才发现存不进去：超出上限服务端
                           会截断，界面先拦住。 */
                        disabled: visibleSelectedCount === visible.length || atLimit,
                        onClick: selectVisible,
                      },
                      clear: {
                        label: t("classTags.members.clear"),
                        disabled: visibleSelectedCount === 0,
                        onClick: clearVisible,
                      },
                    }}
                    /* 到上限之后没勾上的那些一起变灰，不写出来的话那是一片没有理由的灰。 */
                    status={atLimit ? (
                      <Text size="xs" c="dimmed">
                        {t("classTags.members.limitReached", { max: MAX_MEMBERS })}
                      </Text>
                    ) : null}
                  />
                )}
              </div>

              {existing ? (
                <Text className="admin-class-tags__usage" size="xs" c="dimmed">
                  {t("classTags.usage", { count: existing.usage_count })}
                </Text>
              ) : null}
            </div>

            {/* 提交这一组钉在底边，跟职业页同一个理由：清单一长，排在它后面的保存
                按钮就落到视口外面去了。查看态没有可提交的东西，整条不出现。 */}
            {controller.editing ? (
              <div className="admin-md__detail-foot">
                <Group justify="flex-end" gap={8} ml="auto">
                  {/* 现在的「取消」是真的撤销：把草稿退回服务端那份（新建时收起右栏），
                      不再只是把面板关掉。 */}
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

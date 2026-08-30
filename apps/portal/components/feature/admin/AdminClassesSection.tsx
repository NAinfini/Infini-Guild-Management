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
import type { ClassCatalogItem } from "@guild/shared";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Progress } from "@portal/components/ui/progress";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { PlusIcon, SaveIcon, TrashIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useAdminClassesController } from "@portal/hooks/useAdminClassesController";
import { verticalDragTransform } from "@portal/utils/sortable-transform";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "../../shared/ClassIcon";
import { EmptyState } from "../../shared/EmptyState";
import { AdminClassEditorForm, isHexColor } from "./AdminClassEditorForm";
import "./AdminClassesSection.css";

/*
 * 清单行 = 一个「点开编辑」按钮 + 一个拖拽手柄，手柄在右。
 *
 * 手柄单独拆出来，而不是把整行做成可拖：整行可拖的话，点一下想编辑、指针却动了
 * 两像素，就会被判成一次拖拽，编辑器打不开。手柄本身是 <button>，所以不能塞进
 * 那个编辑按钮里（按钮不能嵌套按钮），行外层因此多了一层 div。
 */
function SortableClassRow({
  item,
  active,
  disabled,
  onOpen,
}: {
  item: ClassCatalogItem;
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
  } = useSortable({ id: item.id, disabled });
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
      <button
        type="button"
        className={`admin-md__item ${active ? "admin-md__item--active" : ""}`}
        onClick={onOpen}
      >
        <span className="admin-md__item-main">
          <ClassIcon item={item} size={22} label={item.label} />
          <span className="admin-md__item-label">{item.label}</span>
        </span>
        <span className="admin-md__item-meta">
          <Badge variant={item.icon_type === "image" ? "secondary" : "outline"}>
            {item.icon_type === "image" ? t("classes.source.image") : t("classes.source.vector")}
          </Badge>
        </span>
      </button>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="admin-md__grip"
        aria-label={t("classes.aria.dragHandle", { name: item.label })}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <IconGripVertical size={14} />
      </button>
    </div>
  );
}

export function AdminClassesSection({ masterNavigation }: { masterNavigation?: ReactNode }) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const controller = useAdminClassesController();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { draft } = controller;
  const items = controller.query.data;
  const listBlockingError = controller.query.isError && items === undefined;
  const listRefreshError = controller.query.isError && items !== undefined;
  const existing = draft.id
    ? items?.find((item) => item.id === draft.id) ?? null
    : null;
  const canSave =
    draft.label.trim().length > 0
    && isHexColor(draft.color)
    && (
      draft.iconMode === "vector"
      || Boolean(draft.imageFile)
      || existing?.icon_type === "image"
    )
    && controller.isDirty;

  /* 键盘也要能排：只有指针传感器的话，手柄能聚焦却按不动，那是个假的可访问控件。 */
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    controller.reorder(String(event.active.id), String(event.over.id));
  };

  const handleDelete = async (item: ClassCatalogItem) => {
    const expectedUpdatedAt = item.updated_at;
    const accepted = await confirm({
      title: t("classes.confirmDelete.title"),
      description: t("classes.confirmDelete.description", { name: item.label }),
      confirmLabel: t("classes.action.delete"),
      cancelLabel: tc("action.cancel"),
      intent: "danger",
    });
    if (accepted) await controller.remove(item.id, expectedUpdatedAt);
  };

  return (
    <div className="admin-panel admin-md">
      <div className="admin-md__master">
        <div className="admin-md__master-head">
          <div className="admin-md__master-head-row">
            <div className="admin-md__master-copy">
              {masterNavigation ?? <span className="admin-md__master-title">{t("classes.title")}</span>}
              <span className="admin-md__count">{t("classes.count", { count: items?.length ?? 0 })}</span>
            </div>
            <Button
              type="button"
              size="icon-sm"
              aria-label={t("classes.action.create")}
              onClick={controller.openCreate}
            >
              <PlusIcon size={14} />
            </Button>
          </div>
        </div>

        <ScrollArea className="admin-md__list">
          <div className="admin-md__list-stack">
            {listRefreshError ? (
              <Alert variant="destructive">
                <AlertTitle>{tc("loadError")}</AlertTitle>
                <AlertDescription>
                  <span>{tc("loadErrorRetry")}</span>
                  <Button size="sm" variant="outline" loading={controller.query.isFetching} onClick={() => void controller.query.refetch()}>
                    {tc("action.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {controller.query.isLoading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="admin-md__skeleton" />
              ))
            ) : listBlockingError ? (
              <EmptyState
                status="error"
                title={tc("loadError")}
                actions={(
                  <Button variant="outline" size="sm" onClick={() => void controller.query.refetch()}>
                    {tc("action.retry")}
                  </Button>
                )}
              />
            ) : items?.length === 0 ? (
              <EmptyState
                title={t("classes.empty.title")}
                description={t("classes.empty.description")}
                actions={(
                  <Button size="sm" onClick={controller.openCreate}>{t("classes.action.create")}</Button>
                )}
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                /* 键盘排序必须持续重新测量：默认只在拖拽开始时量一次，而键盘每按一次
                   方向键，各行都被 transform 挪过位置了，拿旧矩形去判碰撞会落回自己身上，
                   松手时 over === active，顺序一动不动。 */
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={(items ?? []).map((item) => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {items?.map((item) => (
                    <SortableClassRow
                      key={item.id}
                      item={item}
                      active={controller.opened && draft.id === item.id}
                      /* 上一次重排还在飞时不允许再拖：两个 PATCH 并发时，先发的
                         那个响应可能后到，onSuccess 会把它的旧顺序写回缓存，
                         界面就退回上一次的排法了。 */
                      disabled={controller.reorderPending}
                      onOpen={() => controller.openEdit(item)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="admin-md__detail">
        {controller.opened ? (
          <>
            <div className="admin-md__detail-head">
              <div className="admin-md__detail-head-row">
                <div className="admin-md__detail-heading">
                  <span className="admin-md__detail-title">
                    {draft.id ? t("classes.modal.editTitle") : t("classes.modal.createTitle")}
                  </span>
                  {controller.isDirty ? <Badge variant="outline" className="admin-md__dirty">{t("classes.dirty")}</Badge> : null}
                </div>
                {existing ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-lg"
                          className="admin-md__delete-action"
                          aria-label={t("classes.action.delete")}
                          onClick={() => void handleDelete(existing)}
                          loading={controller.deletePending}
                          disabled={controller.deletePending}
                        />
                      )}
                    >
                      <TrashIcon size={16} />
                    </TooltipTrigger>
                    <TooltipContent>{t("classes.action.delete")}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>

            <ScrollArea className="admin-md__detail-body">
              <div className="admin-md__detail-pad">
                <AdminClassEditorForm
                  draft={draft}
                  existing={existing}
                  fileInputRef={fileInputRef}
                  onDraftChange={controller.setDraft}
                />
              </div>
            </ScrollArea>

            <div className="admin-md__detail-foot">
              {controller.savePending && controller.uploadProgress > 0 ? (
                <Progress
                  className="admin-classes__save-progress"
                  value={controller.uploadProgress}
                  aria-label={t("classes.upload.progress")}
                />
              ) : null}
              <div className="admin-md__detail-actions">
                <Button
                  onClick={controller.save}
                  loading={controller.savePending}
                  disabled={!canSave}
                >
                  <SaveIcon size={16} />
                  {t("classes.action.save")}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="admin-md__empty">
            <EmptyState title={t("classes.selectHint")} description={t("classes.description")} />
          </div>
        )}
      </div>
    </div>
  );
}

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
import { CLASS_ICON_FILE_ACCEPT, CLASS_VECTOR_ICON_IDS, type ClassCatalogItem } from "@guild/shared";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Progress } from "@portal/components/ui/progress";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { PhotoIcon, PlusIcon, SaveIcon, TrashIcon, UploadIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useAdminClassesController } from "@portal/hooks/useAdminClassesController";
import { verticalDragTransform } from "@portal/utils/sortable-transform";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon, CLASS_VECTOR_ICON_COMPONENTS } from "../../shared/ClassIcon";
import { EmptyState } from "../../shared/EmptyState";
import "./AdminClassesSection.css";

const COLOR_SWATCHES = [
  "#61B8AA",
  "#6EA8FE",
  "#A78BFA",
  "#E27676",
  "#D6A85F",
  "#E18BB6",
  "#75B86B",
  "#8594A8",
];

const isHexColor = (value: string) => /^#[0-9A-Fa-f]{6}$/.test(value);

function LocalImagePreview({
  file,
  label,
  className = "admin-classes__local-preview",
}: {
  file: File;
  label: string;
  className?: string;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={label} className={className} />;
}

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
    const accepted = await confirm({
      title: t("classes.confirmDelete.title"),
      description: t("classes.confirmDelete.description", { name: item.label }),
      confirmLabel: t("classes.action.delete"),
      cancelLabel: tc("action.cancel"),
      intent: "danger",
    });
    if (accepted) await controller.remove(item.id);
  };

  const setColor = (color: string) => {
    controller.setDraft((current) => ({ ...current, color }));
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
            {controller.query.isLoading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="admin-md__skeleton" />
              ))
            ) : controller.query.isError ? (
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
                <div className="admin-classes__editor">
                  <aside className="admin-classes__preview-panel">
                    <span className="admin-classes__preview-label">{t("classes.preview")}</span>
                    <div className="admin-classes__preview-icon">
                      {draft.iconMode === "image" && draft.imageFile ? (
                        <LocalImagePreview file={draft.imageFile} label={draft.label || t("classes.preview")} />
                      ) : (
                        <ClassIcon
                          item={{
                            label: draft.label,
                            color: draft.color,
                            icon_type: draft.iconMode,
                            vector_icon: draft.vectorIcon,
                            icon_media_id: existing?.icon_media_id ?? null,
                          }}
                          size={72}
                          label={draft.label || t("classes.preview")}
                        />
                      )}
                    </div>
                    <span className="admin-classes__preview-name">
                      {draft.label.trim() || t("classes.untitled")}
                    </span>
                    <span className="admin-classes__preview-color">{draft.color.toUpperCase()}</span>
                  </aside>

                  <div className="admin-classes__form">
                    <div className="admin-md__field">
                      <Label htmlFor="class-label">{t("classes.field.label")}</Label>
                      <Input
                        id="class-label"
                        value={draft.label}
                        maxLength={80}
                        onChange={(event) => {
                          /* 先当场取值：setDraft 的 updater 是 React 之后才调用的，
                             那时 event.currentTarget 已经是 null，在里面读 .value 会整页崩掉。 */
                          const { value } = event.currentTarget;
                          controller.setDraft((current) => ({ ...current, label: value }));
                        }}
                        required
                      />
                      <p className="admin-md__field-description">{t("classes.field.labelDescription")}</p>
                    </div>

                    {/* 排序只由左栏拖拽更新，编辑表单不写 sort_order。 */}
                    <div className="admin-md__field admin-classes__color-field">
                      <Label htmlFor="class-color-picker">{t("classes.field.color")}</Label>
                      <div className="admin-classes__color-controls">
                        <Input
                          id="class-color-picker"
                          type="color"
                          className="admin-classes__color-picker"
                          aria-label={t("classes.aria.pickScreenColor")}
                          value={isHexColor(draft.color) ? draft.color : COLOR_SWATCHES[0]}
                          onChange={(event) => setColor(event.currentTarget.value.toUpperCase())}
                        />
                        <Input
                          type="text"
                          inputMode="text"
                          className="admin-classes__color-value"
                          value={draft.color}
                          maxLength={7}
                          pattern="#[0-9A-Fa-f]{6}"
                          aria-label={t("classes.field.color")}
                          onChange={(event) => setColor(event.currentTarget.value)}
                        />
                      </div>
                      <div className="admin-classes__color-swatches" role="group" aria-label={t("classes.field.color")}>
                        {COLOR_SWATCHES.map((swatch) => (
                          <button
                            key={swatch}
                            type="button"
                            className="admin-classes__color-swatch"
                            style={{ "--class-swatch": swatch } as CSSProperties}
                            aria-label={swatch}
                            aria-pressed={draft.color.toUpperCase() === swatch}
                            onClick={() => setColor(swatch)}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="admin-md__field">
                      <span className="admin-md__field-label">{t("classes.field.source")}</span>
                      <div className="admin-classes__source-options" role="group" aria-label={t("classes.field.source")}>
                        <Button
                          type="button"
                          variant={draft.iconMode === "vector" ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={draft.iconMode === "vector"}
                          onClick={() => controller.setDraft((current) => ({ ...current, iconMode: "vector" }))}
                        >
                          {t("classes.source.vector")}
                        </Button>
                        <Button
                          type="button"
                          variant={draft.iconMode === "image" ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={draft.iconMode === "image"}
                          onClick={() => controller.setDraft((current) => ({ ...current, iconMode: "image" }))}
                        >
                          {t("classes.source.image")}
                        </Button>
                      </div>
                    </div>

                    {draft.iconMode === "vector" ? (
                      <div className="admin-classes__icon-library">
                        <span className="admin-md__field-label">{t("classes.field.fallbackIcon")}</span>
                        <p className="admin-md__field-description">{t("classes.field.fallbackDescription")}</p>
                        <div className="admin-classes__icon-grid" role="group" aria-label={t("classes.iconLibrary")}>
                          {CLASS_VECTOR_ICON_IDS.map((iconId) => {
                            const Icon = CLASS_VECTOR_ICON_COMPONENTS[iconId];
                            const selected = draft.vectorIcon === iconId;
                            const iconLabel = t(`classes.icon.${iconId}`, { defaultValue: iconId });
                            return (
                              <Tooltip key={iconId}>
                                <TooltipTrigger
                                  render={(
                                    <button
                                      type="button"
                                      className={`admin-classes__icon-option${selected ? " admin-classes__icon-option--selected" : ""}`}
                                      aria-pressed={selected}
                                      aria-label={t("classes.aria.selectIcon", { icon: iconLabel })}
                                      onClick={() => controller.setDraft((current) => ({ ...current, vectorIcon: iconId }))}
                                    />
                                  )}
                                >
                                  <Icon size={20} />
                                </TooltipTrigger>
                                <TooltipContent>{iconLabel}</TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {draft.iconMode === "image" ? (
                      <div className="admin-classes__upload-box">
                        <div className="admin-classes__upload-head">
                          <div className="admin-classes__upload-copy">
                            <span className="admin-classes__upload-title">{t("classes.upload.title")}</span>
                            <span className="admin-md__muted">{t("classes.upload.description")}</span>
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={CLASS_ICON_FILE_ACCEPT}
                            className="admin-classes__file-input"
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0] ?? null;
                              controller.setDraft((current) => ({ ...current, imageFile: file }));
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <UploadIcon size={16} />
                            {draft.imageFile ? t("classes.upload.replace") : t("classes.upload.choose")}
                          </Button>
                        </div>
                        {draft.imageFile ? (
                          <div className="admin-classes__asset-summary">
                            <LocalImagePreview
                              file={draft.imageFile}
                              label={draft.label || t("classes.preview")}
                              className="admin-classes__asset-thumb"
                            />
                            <div className="admin-classes__asset-copy">
                              <span className="admin-classes__asset-name">{draft.imageFile.name}</span>
                              <span className="admin-classes__asset-meta">
                                <PhotoIcon size={13} />
                                {Math.ceil(draft.imageFile.size / 1024)} KiB · {draft.imageFile.type || "image"}
                              </span>
                            </div>
                          </div>
                        ) : existing?.icon_type === "image" ? (
                          <div className="admin-classes__asset-summary">
                            <ClassIcon item={existing} size={40} label={existing.label} />
                            <div className="admin-classes__asset-copy">
                              <span className="admin-classes__asset-name">{t("classes.upload.currentImage")}</span>
                              <span className="admin-classes__asset-meta">
                                {t("classes.upload.assetId", { id: existing.icon_media_id })}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
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

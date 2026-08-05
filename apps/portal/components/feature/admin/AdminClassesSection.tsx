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
import { CLASS_ICON_FILE_ACCEPT, CLASS_VECTOR_ICON_IDS, type ClassCatalogItem } from "@guild/shared";
import {
  ActionIcon,
  Badge,
  Button,
  ColorInput,
  FileButton,
  Group,
  Progress,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useAdminClassesController } from "@portal/hooks/useAdminClassesController";
import { PhotoIcon, PlusIcon, SaveIcon, TrashIcon, UploadIcon } from "@portal/components/icons";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
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

function LocalImagePreview({ file, label }: { file: File; label: string }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={label} className="admin-classes__local-preview" />;
}

/*
 * 清单行 = 一个「点开编辑」按钮 + 一个拖拽手柄，手柄在右。
 *
 * 手柄单独拆出来，而不是把整行做成可拖：整行可拖的话，点一下想编辑、指针却动了
 * 两像素，就会被判成一次拖拽，编辑器打不开。手柄本身是 <button>，所以不能塞进
 * 那个 UnstyledButton 里（按钮不能嵌套按钮），行外层因此多了一层 div。
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
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="admin-classes__row">
      <UnstyledButton
        className={`admin-md__item ${active ? "admin-md__item--active" : ""}`}
        onClick={onOpen}
      >
        <span className="admin-md__item-main">
          <ClassIcon item={item} size={22} label={item.label} />
          <Text size="sm" fw={500} truncate>{item.label}</Text>
        </span>
        <span className="admin-md__item-meta">
          <Badge size="xs" variant="light" color={item.icon_type === "image" ? "violet" : "gray"}>
            {item.icon_type === "image" ? t("classes.source.image") : t("classes.source.vector")}
          </Badge>
        </span>
      </UnstyledButton>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="admin-classes__grip"
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

export function AdminClassesSection() {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const controller = useAdminClassesController();
  const { draft } = controller;
  const items = controller.query.data;
  const existing = draft.id
    ? items?.find((item) => item.id === draft.id) ?? null
    : null;
  const canSave =
    draft.label.trim().length > 0
    && /^#[0-9A-Fa-f]{6}$/.test(draft.color)
    && (
      draft.iconMode === "vector"
      || Boolean(draft.imageFile)
      || existing?.icon_type === "image"
    );

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

  return (
    <div className="admin-md">
      {/* ── 左栏：职业清单 ── */}
      <div className="admin-md__master">
        <div className="admin-md__master-head">
          <Group gap={8} justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text fw={700} size="sm">{t("classes.title")}</Text>
              <Text size="xs" c="dimmed">{t("classes.count", { count: items?.length ?? 0 })}</Text>
            </div>
            <ActionIcon
              size="sm"
              variant="filled"
              color="portal-brand"
              onClick={controller.openCreate}
              aria-label={t("classes.action.create")}
            >
              <PlusIcon size={14} />
            </ActionIcon>
          </Group>
        </div>

        <ScrollArea className="admin-md__list" type="auto" scrollbarSize={6}>
          <Stack gap={2} p={6}>
            {controller.query.isLoading ? (
              Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} height={40} radius="md" />)
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
          </Stack>
        </ScrollArea>
      </div>

      <div className="admin-md__detail">
        {controller.opened ? (
          <>
            <div className="admin-md__detail-head">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Text fw={700} size="sm">
                  {draft.id ? t("classes.modal.editTitle") : t("classes.modal.createTitle")}
                </Text>
                {existing ? (
                  <Tooltip label={t("classes.action.delete")} withArrow>
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      color="red"
                      onClick={() => void handleDelete(existing)}
                      loading={controller.deletePending}
                      aria-label={t("classes.action.delete")}
                    >
                      <TrashIcon size={16} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              </Group>
            </div>

            <ScrollArea className="admin-md__detail-body" type="auto" scrollbarSize={6}>
              <div className="admin-md__detail-pad">
                <div className="admin-classes__editor">
                  <aside className="admin-classes__preview-panel">
                    <Text size="xs" tt="uppercase" fw={800} c="dimmed">{t("classes.preview")}</Text>
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
                            icon_key: existing?.icon_key ?? null,
                          }}
                          size={72}
                          label={draft.label || t("classes.preview")}
                        />
                      )}
                    </div>
                    <Text fw={800} ta="center">{draft.label.trim() || t("classes.untitled")}</Text>
                    <Text size="xs" c="dimmed" ta="center">{draft.color.toUpperCase()}</Text>
                  </aside>

                  <Stack gap={16} className="admin-classes__form">
                    <TextInput
                      label={t("classes.field.label")}
                      description={t("classes.field.labelDescription")}
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
                    {/* 排序只由左栏拖拽更新，编辑表单不写 sort_order。 */}
                    <ColorInput
                      className="admin-classes__color-field"
                      label={t("classes.field.color")}
                      value={draft.color}
                      swatches={COLOR_SWATCHES}
                      format="hex"
                      withPicker
                      eyeDropperButtonProps={{ "aria-label": t("classes.aria.pickScreenColor") }}
                      onChange={(color) => controller.setDraft((current) => ({ ...current, color }))}
                    />


                    <div>
                      <Text size="sm" fw={600} mb={6}>{t("classes.field.source")}</Text>
                      {/* 图标来源选项按内容宽度呈现为一组互斥控件。 */}
                      <SegmentedControl
                        value={draft.iconMode}
                        data={[
                          { value: "vector", label: t("classes.source.vector") },
                          { value: "image", label: t("classes.source.image") },
                        ]}
                        onChange={(value) => controller.setDraft((current) => ({
                          ...current,
                          iconMode: value as "vector" | "image",
                        }))}
                      />
                    </div>

                    {draft.iconMode === "vector" ? (
                      <div>
                        <Text size="sm" fw={600}>{t("classes.field.fallbackIcon")}</Text>
                        <Text size="xs" c="dimmed" mb={8}>{t("classes.field.fallbackDescription")}</Text>
                        <div className="admin-classes__icon-grid" role="group" aria-label={t("classes.iconLibrary")}>
                          {CLASS_VECTOR_ICON_IDS.map((iconId) => {
                            const Icon = CLASS_VECTOR_ICON_COMPONENTS[iconId];
                            const selected = draft.vectorIcon === iconId;
                            const iconLabel = t(`classes.icon.${iconId}`, { defaultValue: iconId });
                            return (
                              <Tooltip key={iconId} label={iconLabel} withArrow>
                                <button
                                  type="button"
                                  className={`admin-classes__icon-option${selected ? " admin-classes__icon-option--selected" : ""}`}
                                  aria-pressed={selected}
                                  aria-label={t("classes.aria.selectIcon", { icon: iconLabel })}
                                  onClick={() => controller.setDraft((current) => ({ ...current, vectorIcon: iconId }))}
                                >
                                  <Icon size={20} />
                                </button>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {draft.iconMode === "image" ? (
                      <div className="admin-classes__upload-box">
                        <Group justify="space-between" align="center" gap={12}>
                          <div>
                            <Text size="sm" fw={700}>{t("classes.upload.title")}</Text>
                            <Text size="xs" c="dimmed">{t("classes.upload.description")}</Text>
                          </div>
                          <FileButton
                            accept={CLASS_ICON_FILE_ACCEPT}
                            onChange={(file) => controller.setDraft((current) => ({ ...current, imageFile: file }))}
                          >
                            {(props) => (
                              <Button {...props} variant="default" leftSection={<UploadIcon size={16} />}>
                                {draft.imageFile ? t("classes.upload.replace") : t("classes.upload.choose")}
                              </Button>
                            )}
                          </FileButton>
                        </Group>
                        {draft.imageFile ? (
                          <Group gap={8} mt={10}>
                            <PhotoIcon size={15} />
                            <Text size="xs" truncate>{draft.imageFile.name}</Text>
                            <Text size="xs" c="dimmed">{Math.ceil(draft.imageFile.size / 1024)} KiB</Text>
                          </Group>
                        ) : existing?.icon_type === "image" ? (
                          <Text size="xs" c="dimmed" mt={10}>{t("classes.upload.keepExisting")}</Text>
                        ) : null}
                      </div>
                    ) : null}

                  </Stack>
                </div>
              </div>
            </ScrollArea>

            <div className="admin-md__detail-foot">
              {controller.savePending && controller.uploadProgress > 0 ? (
                <Progress
                  className="admin-classes__save-progress"
                  value={controller.uploadProgress}
                  animated
                  aria-label={t("classes.upload.progress")}
                />
              ) : null}
              <Group justify="flex-end" gap={8} ml="auto">
                <Button
                  leftSection={<SaveIcon size={16} />}
                  onClick={controller.save}
                  loading={controller.savePending}
                  disabled={!canSave}
                >
                  {t("classes.action.save")}
                </Button>
              </Group>
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

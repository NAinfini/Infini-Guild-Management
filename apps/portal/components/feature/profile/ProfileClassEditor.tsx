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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ActionIcon, Popover, Select, Text, Tooltip } from "@mantine/core";
import { PlusIcon, TrashIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { IconGripVertical } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type ProfileClassEditorProps = {
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  onClassDraftChange: (value: string) => void;
  onAddClass: (value: string) => void;
  onClassDragEnd: (event: DragEndEvent) => void;
  onRemoveClass: (index: number) => void;
};

type SortableClassRowProps = {
  value: string;
  isPrimary: boolean;
  onRemove: () => void;
};

function SortableClassRow({
  value,
  isPrimary,
  onRemove,
}: SortableClassRowProps) {
  const { t } = useTranslation("profile");
  const catalog = useClassCatalog();
  const item = resolveClassCatalogItem(value, catalog);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: value });

  return (
    <span
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={[
        "profile-class__pill",
        isPrimary ? "profile-class__pill--primary" : "",
        isDragging ? "profile-class__pill--dragging" : "",
      ].filter(Boolean).join(" ")}
    >
      <Tooltip label={t("classRow.aria.drag", { value: item.label })} withArrow>
        <ActionIcon
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          size="xs"
          variant="subtle"
          color="gray"
          aria-label={t("classRow.aria.drag", { value: item.label })}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          <IconGripVertical size={14} />
        </ActionIcon>
      </Tooltip>
      <ClassIcon item={item} size={16} />
      <Tooltip label={t("classRow.primaryHint")} withArrow disabled={!isPrimary}>
        <Text component="span" size="sm" fw={isPrimary ? 700 : 600} className="profile-class__pill-label">
          {item.label}
        </Text>
      </Tooltip>
      <Tooltip label={t("classRow.remove")} withArrow>
        <ActionIcon
          size="xs"
          color="red"
          variant="subtle"
          aria-label={t("classRow.remove")}
          onClick={onRemove}
        >
          <TrashIcon size={14} />
        </ActionIcon>
      </Tooltip>
    </span>
  );
}

export function ProfileClassEditor({
  classDraft,
  classOptions,
  classList,
  onClassDraftChange,
  onAddClass,
  onClassDragEnd,
  onRemoveClass,
}: ProfileClassEditorProps) {
  const { t } = useTranslation("profile");
  const [pickerOpen, setPickerOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <div className="profile-class">
      <Text component="span" size="sm" fw={600} className="profile-class__label">
        {t("section.classes")}
      </Text>
      {/*
       * 选择器收进「+ 添加」里。它常驻时是一个和简介同宽的下拉框加一个按钮，占掉
       * 一整行，而添加职业是一次性动作——已有的职业才是这一栏平时要看的东西。
       */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onClassDragEnd}>
        {/* rect 而不是 vertical：胶囊会换行，落点可能在右边也可能在下一行。 */}
        <SortableContext items={classList} strategy={rectSortingStrategy}>
          <div className="profile-class__pills">
            {classList.map((item, index) => (
              <SortableClassRow
                key={item}
                value={item}
                isPrimary={index === 0}
                onRemove={() => onRemoveClass(index)}
              />
            ))}

            <Popover
              opened={pickerOpen}
              onChange={setPickerOpen}
              position="bottom-start"
              withArrow
              trapFocus
            >
              <Popover.Target>
                <button
                  type="button"
                  className="profile-class__add"
                  onClick={() => setPickerOpen((open) => !open)}
                >
                  <PlusIcon size={13} />
                  {t("action.add")}
                </button>
              </Popover.Target>
              <Popover.Dropdown>
                <Select
                  searchable
                  data={classOptions}
                  value={classDraft || null}
                  w={220}
                  placeholder={t("field.selectClass")}
                  aria-label={t("aria.selectClass")}
                  onSearchChange={onClassDraftChange}
                  onChange={(value) => {
                    if (!value) return;
                    // 选中即添加：留一个「添加」按钮的话，选完还要再点一次，而这个
                    // 下拉框本身就是为这一次添加才打开的。
                    onAddClass(value);
                    onClassDraftChange("");
                    setPickerOpen(false);
                  }}
                />
              </Popover.Dropdown>
            </Popover>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

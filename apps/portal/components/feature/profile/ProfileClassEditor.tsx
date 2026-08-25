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
import { Button } from "@portal/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@portal/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@portal/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
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
      <Tooltip>
        <TooltipTrigger render={(
          <Button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            size="icon-xs"
            variant="ghost"
            aria-label={t("classRow.aria.drag", { value: item.label })}
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
          />
        )}>
          <IconGripVertical size={14} />
        </TooltipTrigger>
        <TooltipContent>{t("classRow.aria.drag", { value: item.label })}</TooltipContent>
      </Tooltip>
      <ClassIcon item={item} size={16} />
      {isPrimary ? (
        <Tooltip>
          <TooltipTrigger render={<span className="profile-class__pill-label profile-class__pill-label--primary" />}>
            {item.label}
          </TooltipTrigger>
          <TooltipContent>{t("classRow.primaryHint")}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="profile-class__pill-label">
          {item.label}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger render={(
          <Button
            type="button"
            size="icon-xs"
            variant="destructive"
            aria-label={t("classRow.remove")}
            onClick={onRemove}
          />
        )}>
          <TrashIcon size={14} />
        </TooltipTrigger>
        <TooltipContent>{t("classRow.remove")}</TooltipContent>
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
      <span className="profile-class__label">
        {t("section.classes")}
      </span>
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
              open={pickerOpen}
              onOpenChange={setPickerOpen}
            >
              <PopoverTrigger render={<button type="button" className="profile-class__add" />}>
                  <PlusIcon size={13} />
                  {t("action.add")}
              </PopoverTrigger>
              <PopoverContent align="start" className="profile-class__picker">
                <Command>
                  <CommandInput
                    value={classDraft}
                    placeholder={t("field.selectClass")}
                    aria-label={t("aria.selectClass")}
                    onValueChange={onClassDraftChange}
                  />
                  <CommandList>
                    <CommandEmpty>{t("classRow.noResults")}</CommandEmpty>
                    {classOptions.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.value}`}
                        onSelect={() => {
                          onAddClass(option.value);
                          onClassDraftChange("");
                          setPickerOpen(false);
                        }}
                      >
                        {option.label}
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

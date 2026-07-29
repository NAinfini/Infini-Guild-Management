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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { resolveClassDisplayColor } from "@guild/shared/constants/classes";
import { ActionIcon, Badge, Button, Group, Select, Stack, Text, Tooltip } from "@mantine/core";
import { PlusIcon, TrashIcon } from "@portal/components/icons";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import { IconGripVertical } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

type ProfileClassEditorProps = {
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  onClassDraftChange: (value: string) => void;
  onAddClass: () => void;
  onClassDragEnd: (event: DragEndEvent) => void;
  onRemoveClass: (index: number) => void;
};

type SortableClassRowProps = {
  value: string;
  index: number;
  isPrimary: boolean;
  onRemove: () => void;
};

function SortableClassRow({
  value,
  index,
  isPrimary,
  onRemove,
}: SortableClassRowProps) {
  const { t } = useTranslation("profile");
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
    <Group
      ref={setNodeRef}
      wrap="wrap"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`my-profile-sortable-row ${isDragging ? "my-profile-sortable-row--dragging" : ""}`.trim()}
    >
      <Tooltip label={t("classRow.aria.drag", { value })} withArrow>
        <ActionIcon
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          size="sm"
          variant="default"
          aria-label={t("classRow.aria.drag", { value })}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          <IconGripVertical size={18} />
        </ActionIcon>
      </Tooltip>
      <Badge color={resolveClassDisplayColor(value, isPrimary ? "yellow" : "gray")}>
        {value}
      </Badge>
      <Tooltip label={t("classRow.remove")} withArrow>
        <ActionIcon
          size="sm"
          color="red"
          variant="filled"
          aria-label={t("classRow.remove")}
          onClick={onRemove}
        >
          <TrashIcon size={16} />
        </ActionIcon>
      </Tooltip>
      <Text c="dimmed" size="sm" style={{ fontSize: 12 }}>
        #{index + 1}
      </Text>
    </Group>
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <>
      <SectionHeader title={t("section.classes")} />
      <Group gap={8} wrap="nowrap">
        <Select
          searchable
          value={classDraft || null}
          data={classOptions}
          style={{ flex: 1 }}
          placeholder={t("field.selectClass")}
          aria-label={t("aria.selectClass")}
          onChange={(value) => onClassDraftChange(value ?? "")}
          onSearchChange={onClassDraftChange}
        />
        <Button onClick={onAddClass} leftSection={<PlusIcon size={16} />}>
          {t("action.add")}
        </Button>
      </Group>
      {classList.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onClassDragEnd}>
          <SortableContext items={classList} strategy={verticalListSortingStrategy}>
            <Stack gap={6} mt={8}>
              {classList.map((item, index) => (
                <SortableClassRow
                  key={item}
                  value={item}
                  index={index}
                  isPrimary={index === 0}
                  onRemove={() => onRemoveClass(index)}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      ) : null}
    </>
  );
}

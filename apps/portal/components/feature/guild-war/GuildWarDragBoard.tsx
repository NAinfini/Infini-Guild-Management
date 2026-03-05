import { DndContext, DragOverlay, closestCenter, useDroppable, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ActionIcon, Badge, Card, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconUser, IconShield, IconBolt } from "@tabler/icons-react";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import type { ComponentProps, CSSProperties, MouseEvent, ReactNode } from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";

type DragMemberItem = {
  itemId: string;
  userId: string;
  username: string;
  power: number;
  class: string;
  subtitle: string;
};

type DragMemberColumn = {
  containerId: string;
  title: ReactNode;
  locked: boolean;
  members: DragMemberItem[];
};

type ActiveDragItem = {
  userId: string;
  username: string;
  power: number;
  class: string;
  subtitle: string;
};

type GuildWarDragBoardProps = {
  dragColumns: DragMemberColumn[];
  canDrag: boolean;
  emptyText: string;
  activePoolStatus?: ReactNode;
  selectedUserIds: Set<string>;
  activeSearch: string;
  activeDragItem: ActiveDragItem | null;
  toMemberDomId: (itemId: string) => string;
  sensors: NonNullable<ComponentProps<typeof DndContext>["sensors"]>;
  onSelectMember: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenMember?: (userId: string) => void;
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  teamStatusContentByContainerId?: Record<string, ReactNode>;
};


function SortableMemberCard(props: {
  itemId: string;
  domId: string;
  username: string;
  power: number;
  class: string;
  disabled: boolean;
  selected: boolean;
  isMatched: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpen?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.itemId,
    disabled: props.disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const classNames = [
    "guild-war-member-card",
    props.disabled ? "guild-war-member-card--disabled" : "",
    props.selected ? "guild-war-member-card--selected" : "",
    !props.selected && props.isMatched ? "guild-war-member-card--matched" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      id={props.domId}
      ref={setNodeRef}
      style={style}
      className={classNames}
      onClick={props.onSelect}
      onDoubleClick={props.onOpen}
      aria-label={`Select member ${props.username}`}
      disabled={props.disabled}
      {...attributes}
      {...listeners}
    >
      <Stack gap={2}>
        <Text size="sm" fw={500}>{props.username}</Text>
        <Group gap={8} wrap="nowrap">
          <Text c="dimmed" size="xs">{props.class}</Text>
          <Text c="dimmed" size="xs">⚡{props.power}</Text>
        </Group>
      </Stack>
    </button>
  );
}

function DroppableMemberColumn(props: {
  column: DragMemberColumn;
  canDrag: boolean;
  emptyText: string;
  statusContent?: ReactNode;
  selectedUserIds: Set<string>;
  activeSearch: string;
  toMemberDomId: (itemId: string) => string;
  onSelectMember: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenMember?: (userId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `container:${props.column.containerId}`,
  });
  const { t } = useTranslation("guild-war");

  const [sortBy, setSortBy] = useState<"username" | "class" | "power" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedMembers = useMemo(() => {
    if (!sortBy) return props.column.members;
    const sorted = [...props.column.members].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "username") cmp = a.username.localeCompare(b.username);
      else if (sortBy === "class") cmp = a.class.localeCompare(b.class);
      else if (sortBy === "power") cmp = a.power - b.power;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [props.column.members, sortBy, sortDir]);

  const toggleSort = (field: "username" | "class" | "power") => {
    if (sortBy === field) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortBy(null); setSortDir("asc"); }
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  return (
    <InfiniCard
      interactive={false}
      className={`guild-war-column-card ${isOver ? "guild-war-column-card--over" : ""}`}
      style={{ overflow: "visible" }}
    >
      <Stack gap={8} mb="sm" className="guild-war-column-header">
        <Group gap={8} justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>{props.column.title}</Text>
            <Badge size="sm" variant="light">{props.column.members.length}</Badge>
            {props.column.locked ? <Badge color="infini-danger" size="sm">{t("active.locked")}</Badge> : null}
          </Group>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={t("active.sort.username")}>
              <ActionIcon size="sm" variant={sortBy === "username" ? "filled" : "subtle"} onClick={() => toggleSort("username")}>
                <IconUser size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("active.sort.class")}>
              <ActionIcon size="sm" variant={sortBy === "class" ? "filled" : "subtle"} onClick={() => toggleSort("class")}>
                <IconShield size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("active.sort.power")}>
              <ActionIcon size="sm" variant={sortBy === "power" ? "filled" : "subtle"} onClick={() => toggleSort("power")}>
                <IconBolt size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        {props.statusContent ? <div className="guild-war-column-header-status">{props.statusContent}</div> : null}
      </Stack>
      <div ref={setNodeRef}>
        <SortableContext items={sortedMembers.map((member) => member.itemId)} strategy={verticalListSortingStrategy}>
          <Stack className="guild-war-column-stack" gap={8}>
            {sortedMembers.length === 0 ? (
              <EmptyState title={props.emptyText} />
            ) : (
              sortedMembers.map((member) => (
                <SortableMemberCard
                  key={member.itemId}
                  itemId={member.itemId}
                  domId={props.toMemberDomId(member.itemId)}
                  username={member.username}
                  power={member.power}
                  class={member.class}
                  disabled={!props.canDrag || props.column.locked}
                  selected={props.selectedUserIds.has(member.userId)}
                  isMatched={
                    props.activeSearch.trim().length > 0 &&
                    `${member.username} ${member.class} ${member.power}`.toLowerCase().includes(props.activeSearch.toLowerCase())
                  }
                  onSelect={(event) => props.onSelectMember(member.userId, event)}
                  onOpen={props.onOpenMember ? () => props.onOpenMember?.(member.userId) : undefined}
                />
              ))
            )}
          </Stack>
        </SortableContext>
      </div>
    </InfiniCard>
  );
}

export function GuildWarDragBoard({
  dragColumns,
  canDrag,
  emptyText,
  activePoolStatus,
  selectedUserIds,
  activeSearch,
  activeDragItem,
  toMemberDomId,
  sensors,
  onSelectMember,
  onOpenMember,
  onDragStart,
  onDragCancel,
  onDragEnd,
  teamStatusContentByContainerId,
}: GuildWarDragBoardProps) {
  const poolColumn = dragColumns.find((col) => col.containerId === "pool");
  const teamColumns = dragColumns.filter((col) => col.containerId !== "pool");

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        <div className="guild-war-dnd-split">
          {/* Pool — fixed left column */}
          <div className="guild-war-dnd-pool">
            {poolColumn ? (
              <DroppableMemberColumn
                column={poolColumn}
                canDrag={canDrag}
                emptyText={emptyText}
                statusContent={activePoolStatus}
                selectedUserIds={selectedUserIds}
                activeSearch={activeSearch}
                toMemberDomId={toMemberDomId}
                onSelectMember={onSelectMember}
                onOpenMember={onOpenMember}
              />
            ) : null}
          </div>

          {/* Teams — vertical list area */}
          <div className="guild-war-dnd-teams-wrap">
            <div className="guild-war-dnd-teams">
              {teamColumns.map((column) => (
                <DroppableMemberColumn
                  key={column.containerId}
                  column={column}
                  canDrag={canDrag}
                  emptyText={emptyText}
                  statusContent={teamStatusContentByContainerId?.[column.containerId] ?? null}
                  selectedUserIds={selectedUserIds}
                  activeSearch={activeSearch}
                  toMemberDomId={toMemberDomId}
                  onSelectMember={onSelectMember}
                  onOpenMember={onOpenMember}
                />
              ))}
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeDragItem ? (
            <Card withBorder p="sm">
              <Stack gap={2}>
                <Text size="sm" fw={500}>{activeDragItem.username}</Text>
                <Group gap={8} wrap="nowrap">
                  <Text c="dimmed" size="xs">{activeDragItem.class}</Text>
                  <Text c="dimmed" size="xs">⚡{activeDragItem.power}</Text>
                </Group>
              </Stack>
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

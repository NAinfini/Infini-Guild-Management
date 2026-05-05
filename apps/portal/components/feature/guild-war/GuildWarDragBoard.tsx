import { DndContext, DragOverlay, closestCenter, useDroppable, type DragEndEvent, type DragStartEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ActionIcon, Badge, Card, Group, HoverCard, Stack, Text, TextInput, ThemeIcon } from "@mantine/core";
import { UserIcon, ShieldIcon, BoltIcon, CopyIcon, ChevronUpIcon, ChevronDownIcon, LockIcon, UnlockIcon, UserPlusIcon } from "@portal/components/icons";
import { PortalCard } from "../../shared/PortalCard";
import { memo, useState, useMemo } from "react";
import type { ComponentProps, CSSProperties, MouseEvent, ReactNode } from "react";
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
  disabled?: boolean;
  onTeamContextMenu?: (containerId: string, event: MouseEvent<HTMLDivElement>) => void;
  onMemberContextMenu?: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onPoolContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onCopyTeamMentions?: (containerId: string) => void;
  onToggleLock?: (containerId: string) => void;
  onMoveTeam?: (containerId: string, direction: "up" | "down") => void;
  lockedTeamIds?: Set<string>;
  teamCount?: number;
  teamIndexMap?: Map<string, number>;
  onAddToPool?: () => void;
  onDraftNameChange?: (containerId: string, value: string) => void;
};


const SortableMemberCard = memo(function SortableMemberCard(props: {
  itemId: string;
  domId: string;
  username: string;
  power: number;
  class: string;
  disabled: boolean;
  selected: boolean;
  isMatched: boolean;
  userId: string;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpen?: () => void;
  onContextMenu?: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.itemId,
    disabled: props.disabled,
  });
  const { t } = useTranslation("guild-war");

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
      onContextMenu={(e) => {
        if (props.onContextMenu) {
          e.preventDefault();
          props.onContextMenu(props.userId, e);
        }
      }}
      aria-label={t("active.aria.selectMember", { username: props.username })}
      disabled={props.disabled}
      {...attributes}
      {...listeners}
    >
      <Stack gap={2}>
        <Text size="sm" fw={500}>{props.username}</Text>
        <Group gap={8} wrap="nowrap">
          <Text c="dimmed" size="xs">{props.class}</Text>
          <Text c="dimmed" size="xs"><BoltIcon size={12} style={{ display: "inline-block", verticalAlign: "-1px" }} /> {props.power}</Text>
        </Group>
      </Stack>
    </button>
  );
});

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
  onTeamContextMenu?: (containerId: string, event: MouseEvent<HTMLDivElement>) => void;
  onMemberContextMenu?: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onPoolContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onCopyTeamMentions?: (containerId: string) => void;
  onToggleLock?: (containerId: string) => void;
  onMoveTeam?: (containerId: string, direction: "up" | "down") => void;
  isLocked?: boolean;
  teamIndex?: number;
  teamCount?: number;
  onAddToPool?: () => void;
  onDraftNameChange?: (containerId: string, value: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `container:${props.column.containerId}`,
  });
  const { t } = useTranslation("guild-war");
  const isPoolColumn = props.column.containerId === "pool";
  const isTeamColumn = !isPoolColumn;

  const [isEditingName, setIsEditingName] = useState(false);
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
    <PortalCard
      interactive={false}
      className={`guild-war-column-card ${isOver ? "guild-war-column-card--over" : ""}`}
      style={{ overflow: "visible" }}
    >
      <div
        ref={setNodeRef}
        onContextMenu={(e) => {
          if (props.column.containerId === "pool" && props.onPoolContextMenu) {
            e.preventDefault();
            props.onPoolContextMenu(e);
          } else if (props.column.containerId !== "pool" && props.onTeamContextMenu) {
            e.preventDefault();
            props.onTeamContextMenu(props.column.containerId, e);
          }
        }}
      >
      <Stack gap={8} mb="sm" className="guild-war-column-header">
        <Group gap={8} justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            {isTeamColumn && isEditingName && props.onDraftNameChange ? (
              <TextInput
                value={String(props.column.title)}
                onChange={(e) => props.onDraftNameChange?.(props.column.containerId, e.currentTarget.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => { if (e.key === "Enter") setIsEditingName(false); }}
                size="xs"
                autoFocus
                aria-label={t("active.aria.teamName", { teamName: props.column.title })}
                styles={{ input: { fontWeight: 600, fontSize: 14, padding: "0 6px", height: 24, minHeight: 24 } }}
              />
            ) : (
              <Text
                size="sm"
                fw={600}
                truncate
                style={isTeamColumn && props.onDraftNameChange ? { cursor: "text" } : undefined}
                onClick={isTeamColumn && props.onDraftNameChange ? () => setIsEditingName(true) : undefined}
              >
                {props.column.title}
              </Text>
            )}
            <Badge size="sm" variant="default">{props.column.members.length}</Badge>
            {props.column.locked ? (
              <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                <HoverCard.Target>
                  <Badge color="red" size="sm" style={{ cursor: "default" }}>{t("active.locked")}</Badge>
                </HoverCard.Target>
                <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                  <Group gap={10} wrap="nowrap" align="flex-start">
                    <ThemeIcon variant="light" color="red" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                      <LockIcon size={16} />
                    </ThemeIcon>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={700} lh={1.3} mb={4}>{t("hovercard.lockedBadge.title")}</Text>
                      <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.lockedBadge.desc")}</Text>
                    </div>
                  </Group>
                </HoverCard.Dropdown>
              </HoverCard>
            ) : null}
          </Group>
          <Group gap={4} wrap="nowrap">
            {isTeamColumn && props.onToggleLock ? (
              <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                <HoverCard.Target>
                  <ActionIcon size="sm" variant={props.isLocked ? "filled" : "subtle"} color={props.isLocked ? "red" : undefined} onClick={() => props.onToggleLock?.(props.column.containerId)} aria-label={props.isLocked ? t("active.teamSetup.locked") : t("active.teamSetup.open")}>
                    {props.isLocked ? <LockIcon size={14} /> : <UnlockIcon size={14} />}
                  </ActionIcon>
                </HoverCard.Target>
                <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                  <Group gap={10} wrap="nowrap" align="flex-start">
                    <ThemeIcon variant="light" color={props.isLocked ? "red" : "green"} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                      {props.isLocked ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
                    </ThemeIcon>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={700} lh={1.3} mb={4}>{props.isLocked ? t("hovercard.lock.title") : t("hovercard.unlock.title")}</Text>
                      <Text size="xs" c="dimmed" lh={1.5}>{props.isLocked ? t("hovercard.lock.desc") : t("hovercard.unlock.desc")}</Text>
                    </div>
                  </Group>
                </HoverCard.Dropdown>
              </HoverCard>
            ) : null}
            {isTeamColumn && props.onMoveTeam ? (
              <>
                <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                  <HoverCard.Target>
                    <ActionIcon size="sm" variant="subtle" onClick={() => props.onMoveTeam?.(props.column.containerId, "up")} disabled={props.teamIndex === 0} aria-label={t("active.teamSetup.moveUp")}>
                      <ChevronUpIcon size={14} />
                    </ActionIcon>
                  </HoverCard.Target>
                  <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                    <Group gap={10} wrap="nowrap" align="flex-start">
                      <ThemeIcon variant="light" color="blue" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                        <ChevronUpIcon size={16} />
                      </ThemeIcon>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={700} lh={1.3}>{t("hovercard.moveUp.title")}</Text>
                        <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.moveUp.desc")}</Text>
                      </div>
                    </Group>
                  </HoverCard.Dropdown>
                </HoverCard>
                <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                  <HoverCard.Target>
                    <ActionIcon size="sm" variant="subtle" onClick={() => props.onMoveTeam?.(props.column.containerId, "down")} disabled={props.teamIndex === (props.teamCount ?? 1) - 1} aria-label={t("active.teamSetup.moveDown")}>
                      <ChevronDownIcon size={14} />
                    </ActionIcon>
                  </HoverCard.Target>
                  <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                    <Group gap={10} wrap="nowrap" align="flex-start">
                      <ThemeIcon variant="light" color="blue" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                        <ChevronDownIcon size={16} />
                      </ThemeIcon>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={700} lh={1.3}>{t("hovercard.moveDown.title")}</Text>
                        <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.moveDown.desc")}</Text>
                      </div>
                    </Group>
                  </HoverCard.Dropdown>
                </HoverCard>
              </>
            ) : null}
            {isTeamColumn && props.onCopyTeamMentions ? (
              <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                <HoverCard.Target>
                  <ActionIcon size="sm" variant="subtle" onClick={() => props.onCopyTeamMentions?.(props.column.containerId)} aria-label={t("active.teamCopied")}>
                    <CopyIcon size={14} />
                  </ActionIcon>
                </HoverCard.Target>
                <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                  <Group gap={10} wrap="nowrap" align="flex-start">
                    <ThemeIcon variant="light" color="blue" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                      <CopyIcon size={16} />
                    </ThemeIcon>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={700} lh={1.3} mb={4}>{t("hovercard.copyTeam.title")}</Text>
                      <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.copyTeam.desc")}</Text>
                    </div>
                  </Group>
                </HoverCard.Dropdown>
              </HoverCard>
            ) : null}
            {isPoolColumn && props.onAddToPool ? (
              <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                <HoverCard.Target>
                  <ActionIcon size="sm" variant="subtle" onClick={props.onAddToPool} aria-label={t("active.addToPool")}>
                    <UserPlusIcon size={14} />
                  </ActionIcon>
                </HoverCard.Target>
                <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                  <Group gap={10} wrap="nowrap" align="flex-start">
                    <ThemeIcon variant="light" color="teal" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                      <UserPlusIcon size={16} />
                    </ThemeIcon>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={700} lh={1.3}>{t("hovercard.addToPool.title")}</Text>
                      <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.addToPool.desc")}</Text>
                    </div>
                  </Group>
                </HoverCard.Dropdown>
              </HoverCard>
            ) : null}
            <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target>
                <ActionIcon size="sm" variant={sortBy === "username" ? "filled" : "subtle"} onClick={() => toggleSort("username")} aria-label={t("active.sort.username")}>
                  <UserIcon size={14} />
                </ActionIcon>
              </HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="blue" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <UserIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3}>{t("hovercard.sortUsername.title")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.sortUsername.desc")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
            <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target>
                <ActionIcon size="sm" variant={sortBy === "class" ? "filled" : "subtle"} onClick={() => toggleSort("class")} aria-label={t("active.sort.class")}>
                  <ShieldIcon size={14} />
                </ActionIcon>
              </HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="blue" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <ShieldIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3}>{t("hovercard.sortClass.title")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.sortClass.desc")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
            <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
              <HoverCard.Target>
                <ActionIcon size="sm" variant={sortBy === "power" ? "filled" : "subtle"} onClick={() => toggleSort("power")} aria-label={t("active.sort.power")}>
                  <BoltIcon size={14} />
                </ActionIcon>
              </HoverCard.Target>
              <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                <Group gap={10} wrap="nowrap" align="flex-start">
                  <ThemeIcon variant="light" color="yellow" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                    <BoltIcon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={700} lh={1.3}>{t("hovercard.sortPower.title")}</Text>
                    <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.sortPower.desc")}</Text>
                  </div>
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
          </Group>
        </Group>
        {props.statusContent ? <div className="guild-war-column-header-status">{props.statusContent}</div> : null}
      </Stack>
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
                  userId={member.userId}
                  disabled={!props.canDrag || props.column.locked}
                  selected={props.selectedUserIds.has(member.userId)}
                  isMatched={
                    props.activeSearch.trim().length > 0 &&
                    `${member.username} ${member.class} ${member.power}`.toLowerCase().includes(props.activeSearch.toLowerCase())
                  }
                  onSelect={(event) => props.onSelectMember(member.userId, event)}
                  onOpen={props.onOpenMember ? () => props.onOpenMember?.(member.userId) : undefined}
                  onContextMenu={props.onMemberContextMenu}
                />
              ))
            )}
          </Stack>
        </SortableContext>
      </div>
    </PortalCard>
  );
}

const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (activatorEvent && draggingNodeRect) {
    const event = activatorEvent as PointerEvent;
    const offsetX = event.clientX - draggingNodeRect.left;
    const offsetY = event.clientY - draggingNodeRect.top;
    return {
      ...transform,
      x: transform.x + offsetX - draggingNodeRect.width / 2,
      y: transform.y + offsetY - draggingNodeRect.height / 2,
    };
  }
  return transform;
};

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
  disabled,
  onTeamContextMenu,
  onMemberContextMenu,
  onPoolContextMenu,
  onCopyTeamMentions,
  onToggleLock,
  onMoveTeam,
  lockedTeamIds,
  teamCount,
  teamIndexMap,
  onAddToPool,
  onDraftNameChange,
}: GuildWarDragBoardProps) {
  const { t } = useTranslation("guild-war");
  const poolColumn = dragColumns.find((col) => col.containerId === "pool");
  const teamColumns = dragColumns.filter((col) => col.containerId !== "pool");

  if (!poolColumn && teamColumns.length === 0) {
    return <EmptyState title={emptyText} description={t("active.emptyBoard")} />;
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        <div className={`guild-war-dnd-split ${disabled ? "guild-war-dnd-split--disabled" : ""}`}>
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
                onPoolContextMenu={onPoolContextMenu}
                onMemberContextMenu={onMemberContextMenu}
                onAddToPool={onAddToPool}
              />
            ) : null}
          </div>

          <div className="guild-war-dnd-teams-wrap">
            <Stack gap={12} className="guild-war-dnd-teams">
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
                  onTeamContextMenu={onTeamContextMenu}
                  onMemberContextMenu={onMemberContextMenu}
                  onCopyTeamMentions={onCopyTeamMentions}
                  onToggleLock={onToggleLock}
                  onMoveTeam={onMoveTeam}
                  isLocked={lockedTeamIds?.has(column.containerId)}
                  teamIndex={teamIndexMap?.get(column.containerId)}
                  teamCount={teamCount}
                  onDraftNameChange={onDraftNameChange}
                />
              ))}
            </Stack>
          </div>
        </div>

        <DragOverlay modifiers={[snapCenterToCursor]}>
          {activeDragItem ? (
            <Card withBorder p="sm">
              <Stack gap={2}>
                <Text size="sm" fw={500}>{activeDragItem.username}</Text>
                <Group gap={8} wrap="nowrap">
                  <Text c="dimmed" size="xs">{activeDragItem.class}</Text>
                  <Text c="dimmed" size="xs"><BoltIcon size={12} style={{ display: "inline-block", verticalAlign: "-1px" }} /> {activeDragItem.power}</Text>
                </Group>
              </Stack>
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

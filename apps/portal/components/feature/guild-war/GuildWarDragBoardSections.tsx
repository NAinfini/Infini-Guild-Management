import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  HoverCard,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  BoltIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  LockIcon,
  ShieldIcon,
  TrashIcon,
  UnlockIcon,
  UserIcon,
  UserPlusIcon,
} from "@portal/components/icons";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { PortalCard } from "../../shared/PortalCard";

export type DragMemberItem = {
  itemId: string;
  userId: string;
  username: string;
  power: number;
  class: string;
  subtitle: string;
};

export type DragMemberColumn = {
  containerId: string;
  title: ReactNode;
  locked: boolean;
  members: DragMemberItem[];
};

export type ActiveDragItem = {
  userId: string;
  username: string;
  power: number;
  class: string;
  subtitle: string;
};

const DRAG_HOLD_MS = 150;

type DraggableMemberCardProps = {
  itemId: string;
  domId: string;
  username: string;
  power: number;
  class: string;
  disabled: boolean;
  selected: boolean;
  isMatched: boolean;
  isAbsent: boolean;
  userId: string;
  onSelectMember: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenMember?: (userId: string) => void;
};

const DraggableMemberCard = memo(function DraggableMemberCard({
  itemId,
  domId,
  username,
  power,
  class: memberClass,
  disabled,
  selected,
  isMatched,
  isAbsent,
  userId,
  onSelectMember,
  onOpenMember,
}: DraggableMemberCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: itemId,
    disabled,
  });
  const { t } = useTranslation("guild-war");
  const [holding, setHolding] = useState(false);
  const holdTimerRef = useRef<number | null>(null);

  const handleSelect = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    onSelectMember(userId, event);
  }, [onSelectMember, userId]);

  const handleOpen = useCallback(() => {
    onOpenMember?.(userId);
  }, [onOpenMember, userId]);

  const clearHold = useCallback(() => {
    setHolding(false);
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }
    setHolding(true);
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
    }, DRAG_HOLD_MS);
    const dndHandler = listeners?.onPointerDown;
    if (dndHandler) {
      (dndHandler as (nextEvent: unknown) => void)(event);
    }
  }, [disabled, listeners]);

  const style: CSSProperties = isDragging
    ? { opacity: 0, pointerEvents: "none" }
    : {};
  const classNames = [
    "guild-war-member-card",
    disabled ? "guild-war-member-card--disabled" : "",
    selected ? "guild-war-member-card--selected" : "",
    !selected && isMatched ? "guild-war-member-card--matched" : "",
    holding && !isDragging ? "guild-war-member-card--holding" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      id={domId}
      ref={setNodeRef}
      style={style}
      className={classNames}
      onClick={handleSelect}
      onDoubleClick={onOpenMember ? handleOpen : undefined}
      aria-label={t("active.aria.selectMember", { username })}
      disabled={disabled}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onPointerLeave={clearHold}
    >
      <div className="guild-war-member-card__progress" />
      <Stack gap={2}>
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={500} truncate>{username}</Text>
          {isAbsent ? (
            <Badge color="portal-copper" size="xs" variant="light" style={{ flexShrink: 0 }}>
              {t("active.absent")}
            </Badge>
          ) : null}
        </Group>
        <Group gap={8} wrap="nowrap">
          <Text c="dimmed" size="xs">{memberClass}</Text>
          <Text c="dimmed" size="xs">
            <BoltIcon size={12} style={{ display: "inline-block", verticalAlign: "-1px" }} /> {power}
          </Text>
        </Group>
      </Stack>
    </button>
  );
});

type DroppableMemberColumnProps = {
  column: DragMemberColumn;
  canDrag: boolean;
  statusContent?: ReactNode;
  selectedUserIds: Set<string>;
  activeSearch: string;
  toMemberDomId: (itemId: string) => string;
  onSelectMember: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenMember?: (userId: string) => void;
  onCopyTeamMentions?: (containerId: string) => void;
  onToggleLock?: (containerId: string) => void;
  onMoveTeam?: (containerId: string, direction: "up" | "down") => void;
  onDeleteTeam?: (containerId: string) => void;
  isLocked?: boolean;
  teamIndex?: number;
  teamCount?: number;
  onAddToPool?: () => void;
  onDraftNameChange?: (containerId: string, value: string) => void;
  isDragActive?: boolean;
  absentUserIds?: Set<string>;
};

export function DroppableMemberColumn({
  column,
  canDrag,
  statusContent,
  selectedUserIds,
  activeSearch,
  toMemberDomId,
  onSelectMember,
  onOpenMember,
  onCopyTeamMentions,
  onToggleLock,
  onMoveTeam,
  onDeleteTeam,
  isLocked,
  teamIndex,
  teamCount,
  onAddToPool,
  onDraftNameChange,
  isDragActive,
  absentUserIds,
}: DroppableMemberColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `container:${column.containerId}`,
  });
  const { t } = useTranslation("guild-war");
  const isPoolColumn = column.containerId === "pool";
  const isTeamColumn = !isPoolColumn;
  const [isEditingName, setIsEditingName] = useState(false);
  const [sortBy, setSortBy] = useState<"username" | "class" | "power" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedMembers = useMemo(() => {
    if (!sortBy) {
      return column.members;
    }
    return [...column.members].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "username") cmp = a.username.localeCompare(b.username);
      else if (sortBy === "class") cmp = a.class.localeCompare(b.class);
      else if (sortBy === "power") cmp = a.power - b.power;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [column.members, sortBy, sortDir]);

  const toggleSort = (field: "username" | "class" | "power") => {
    if (sortBy === field) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortBy(null);
        setSortDir("asc");
      }
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  return (
    <PortalCard
      interactive={false}
      className={`guild-war-column-card${isOver ? " guild-war-column-card--over" : ""}${isDragActive && !isOver ? " guild-war-column-card--drag-active" : ""}`}
      style={{ overflow: "visible" }}
    >
      <div ref={setNodeRef} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <Stack gap={8} mb="sm" className="guild-war-column-header">
          <Group gap={8} justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              {isTeamColumn && isEditingName && onDraftNameChange ? (
                <TextInput
                  value={String(column.title)}
                  onChange={(event) => onDraftNameChange(column.containerId, event.currentTarget.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setIsEditingName(false);
                  }}
                  size="xs"
                  autoFocus
                  aria-label={t("active.aria.teamName", { teamName: column.title })}
                  styles={{ input: { fontWeight: 600, fontSize: 14, padding: "0 6px", height: 24, minHeight: 24 } }}
                />
              ) : (
                <Text
                  size="sm"
                  fw={600}
                  truncate
                  style={isTeamColumn && onDraftNameChange ? { cursor: "text" } : undefined}
                  onClick={isTeamColumn && onDraftNameChange ? () => setIsEditingName(true) : undefined}
                >
                  {column.title}
                </Text>
              )}
              <Badge size="sm" variant="default">{column.members.length}</Badge>
              {column.locked ? (
                <GuildWarColumnActionCard
                  label={<Badge color="red" size="sm" style={{ cursor: "default" }}>{t("active.locked")}</Badge>}
                  icon={<LockIcon size={16} />}
                  iconColor="red"
                  title={t("hovercard.lockedBadge.title")}
                  description={t("hovercard.lockedBadge.desc")}
                />
              ) : null}
            </Group>
            <Group gap={4} wrap="nowrap">
              {isTeamColumn && onToggleLock ? (
                <GuildWarColumnActionCard
                  label={(
                    <ActionIcon
                      size="sm"
                      variant={isLocked ? "filled" : "subtle"}
                      color={isLocked ? "red" : undefined}
                      onClick={() => onToggleLock(column.containerId)}
                      aria-label={isLocked ? t("active.teamSetup.locked") : t("active.teamSetup.open")}
                    >
                      {isLocked ? <LockIcon size={14} /> : <UnlockIcon size={14} />}
                    </ActionIcon>
                  )}
                  icon={isLocked ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
                  iconColor={isLocked ? "red" : "green"}
                  title={isLocked ? t("hovercard.lock.title") : t("hovercard.unlock.title")}
                  description={isLocked ? t("hovercard.lock.desc") : t("hovercard.unlock.desc")}
                />
              ) : null}
              {isTeamColumn && onMoveTeam ? (
                <>
                  <GuildWarColumnActionCard
                    label={(
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        onClick={() => onMoveTeam(column.containerId, "up")}
                        disabled={teamIndex === 0}
                        aria-label={t("active.teamSetup.moveUp")}
                      >
                        <ChevronUpIcon size={14} />
                      </ActionIcon>
                    )}
                    icon={<ChevronUpIcon size={16} />}
                    title={t("hovercard.moveUp.title")}
                    description={t("hovercard.moveUp.desc")}
                  />
                  <GuildWarColumnActionCard
                    label={(
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        onClick={() => onMoveTeam(column.containerId, "down")}
                        disabled={teamIndex === (teamCount ?? 1) - 1}
                        aria-label={t("active.teamSetup.moveDown")}
                      >
                        <ChevronDownIcon size={14} />
                      </ActionIcon>
                    )}
                    icon={<ChevronDownIcon size={16} />}
                    title={t("hovercard.moveDown.title")}
                    description={t("hovercard.moveDown.desc")}
                  />
                </>
              ) : null}
              {isTeamColumn && onCopyTeamMentions ? (
                <GuildWarColumnActionCard
                  label={(
                    <ActionIcon size="sm" variant="subtle" onClick={() => onCopyTeamMentions(column.containerId)} aria-label={t("active.teamCopied")}>
                      <CopyIcon size={14} />
                    </ActionIcon>
                  )}
                  icon={<CopyIcon size={16} />}
                  title={t("hovercard.copyTeam.title")}
                  description={t("hovercard.copyTeam.desc")}
                />
              ) : null}
              {isTeamColumn && onDeleteTeam ? (
                <GuildWarColumnActionCard
                  label={(
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => onDeleteTeam(column.containerId)} aria-label={t("menu.team.delete")}>
                      <TrashIcon size={14} />
                    </ActionIcon>
                  )}
                  icon={<TrashIcon size={16} />}
                  iconColor="red"
                  title={t("hovercard.deleteTeam.title")}
                  description={t("hovercard.deleteTeam.desc")}
                />
              ) : null}
              {isPoolColumn && onAddToPool ? (
                <GuildWarColumnActionCard
                  label={(
                    <ActionIcon size="sm" variant="subtle" onClick={onAddToPool} aria-label={t("active.addToPool")}>
                      <UserPlusIcon size={14} />
                    </ActionIcon>
                  )}
                  icon={<UserPlusIcon size={16} />}
                  iconColor="teal"
                  title={t("hovercard.addToPool.title")}
                  description={t("hovercard.addToPool.desc")}
                />
              ) : null}
              <SortAction active={sortBy === "username"} onClick={() => toggleSort("username")} ariaLabel={t("active.sort.username")} icon={<UserIcon size={14} />} hoverIcon={<UserIcon size={16} />} title={t("hovercard.sortUsername.title")} description={t("hovercard.sortUsername.desc")} />
              <SortAction active={sortBy === "class"} onClick={() => toggleSort("class")} ariaLabel={t("active.sort.class")} icon={<ShieldIcon size={14} />} hoverIcon={<ShieldIcon size={16} />} title={t("hovercard.sortClass.title")} description={t("hovercard.sortClass.desc")} />
              <SortAction active={sortBy === "power"} onClick={() => toggleSort("power")} ariaLabel={t("active.sort.power")} icon={<BoltIcon size={14} />} hoverIcon={<BoltIcon size={16} />} iconColor="yellow" title={t("hovercard.sortPower.title")} description={t("hovercard.sortPower.desc")} />
            </Group>
          </Group>
          {statusContent ? <div className="guild-war-column-header-status">{statusContent}</div> : null}
        </Stack>
        <div className="guild-war-column-stack">
          {sortedMembers.map((member) => (
            <DraggableMemberCard
              key={member.itemId}
              itemId={member.itemId}
              domId={toMemberDomId(member.itemId)}
              username={member.username}
              power={member.power}
              class={member.class}
              userId={member.userId}
              disabled={!canDrag || column.locked}
              selected={selectedUserIds.has(member.userId)}
              isAbsent={absentUserIds?.has(member.userId) ?? false}
              isMatched={
                activeSearch.trim().length > 0
                && `${member.username} ${member.class} ${member.power}`.toLowerCase().includes(activeSearch.toLowerCase())
              }
              onSelectMember={onSelectMember}
              onOpenMember={onOpenMember}
            />
          ))}
        </div>
      </div>
    </PortalCard>
  );
}

type GuildWarColumnActionCardProps = {
  label: ReactNode;
  icon: ReactNode;
  title: string;
  description: string;
  iconColor?: string;
};

function GuildWarColumnActionCard({
  label,
  icon,
  title,
  description,
  iconColor = "blue",
}: GuildWarColumnActionCardProps) {
  return (
    <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
      <HoverCard.Target>{label}</HoverCard.Target>
      <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color={iconColor} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
            {icon}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={700} lh={1.3} mb={4}>{title}</Text>
            <Text size="xs" c="dimmed" lh={1.5}>{description}</Text>
          </div>
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

type SortActionProps = {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  icon: ReactNode;
  hoverIcon: ReactNode;
  title: string;
  description: string;
  iconColor?: string;
};

function SortAction({
  active,
  onClick,
  ariaLabel,
  icon,
  hoverIcon,
  title,
  description,
  iconColor = "blue",
}: SortActionProps) {
  return (
    <GuildWarColumnActionCard
      label={(
        <ActionIcon size="sm" variant={active ? "filled" : "subtle"} onClick={onClick} aria-label={ariaLabel}>
          {icon}
        </ActionIcon>
      )}
      icon={hoverIcon}
      iconColor={iconColor}
      title={title}
      description={description}
    />
  );
}

type TrashDropZoneProps = {
  visible: boolean;
};

export function TrashDropZone({ visible }: TrashDropZoneProps) {
  const { t } = useTranslation("guild-war");
  const { setNodeRef, isOver } = useDroppable({ id: "trash-zone" });

  return (
    <div
      ref={setNodeRef}
      className={`guild-war-trash-zone ${visible ? "guild-war-trash-zone--visible" : ""} ${isOver ? "guild-war-trash-zone--over" : ""}`}
    >
      <TrashIcon size={18} />
      <Text size="sm" fw={500}>{t("active.trashZone")}</Text>
    </div>
  );
}

type GuildWarDragOverlayCardProps = {
  activeDragItem: ActiveDragItem;
};

export function GuildWarDragOverlayCard({ activeDragItem }: GuildWarDragOverlayCardProps) {
  return (
    <Card withBorder p="sm">
      <Stack gap={2}>
        <Text size="sm" fw={500}>{activeDragItem.username}</Text>
        <Group gap={8} wrap="nowrap">
          <Text c="dimmed" size="xs">{activeDragItem.class}</Text>
          <Text c="dimmed" size="xs">
            <BoltIcon size={12} style={{ display: "inline-block", verticalAlign: "-1px" }} /> {activeDragItem.power}
          </Text>
        </Group>
      </Stack>
    </Card>
  );
}

type GuildWarDragBoardLayoutProps = {
  poolColumn?: DragMemberColumn;
  teamColumns: DragMemberColumn[];
  canDrag: boolean;
  selectedUserIds: Set<string>;
  activeSearch: string;
  activeDragItem: ActiveDragItem | null;
  toMemberDomId: (itemId: string) => string;
  onSelectMember: (userId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenMember?: (userId: string) => void;
  activePoolStatus?: ReactNode;
  teamStatusContentByContainerId?: Record<string, ReactNode>;
  disabled?: boolean;
  onCopyTeamMentions?: (containerId: string) => void;
  onToggleLock?: (containerId: string) => void;
  onMoveTeam?: (containerId: string, direction: "up" | "down") => void;
  onDeleteTeam?: (containerId: string) => void;
  lockedTeamIds?: Set<string>;
  teamCount?: number;
  teamIndexMap?: Map<string, number>;
  onAddToPool?: () => void;
  onDraftNameChange?: (containerId: string, value: string) => void;
  absentUserIds?: Set<string>;
};

export function GuildWarDragBoardLayout({
  poolColumn,
  teamColumns,
  canDrag,
  selectedUserIds,
  activeSearch,
  activeDragItem,
  toMemberDomId,
  onSelectMember,
  onOpenMember,
  activePoolStatus,
  teamStatusContentByContainerId,
  disabled,
  onCopyTeamMentions,
  onToggleLock,
  onMoveTeam,
  onDeleteTeam,
  lockedTeamIds,
  teamCount,
  teamIndexMap,
  onAddToPool,
  onDraftNameChange,
  absentUserIds,
}: GuildWarDragBoardLayoutProps) {
  return (
    <div className={`guild-war-dnd-split ${disabled ? "guild-war-dnd-split--disabled" : ""}`}>
      <div className="guild-war-dnd-pool">
        <div className="guild-war-column-card-wrap">
          {poolColumn ? (
            <DroppableMemberColumn
              column={poolColumn}
              canDrag={canDrag}
              statusContent={activePoolStatus}
              selectedUserIds={selectedUserIds}
              activeSearch={activeSearch}
              toMemberDomId={toMemberDomId}
              onSelectMember={onSelectMember}
              onOpenMember={onOpenMember}
              onAddToPool={onAddToPool}
              isDragActive={Boolean(activeDragItem)}
              absentUserIds={absentUserIds}
            />
          ) : null}
          <TrashDropZone visible={Boolean(activeDragItem)} />
        </div>
      </div>

      <div className="guild-war-dnd-teams-wrap">
        <Stack gap={12} className="guild-war-dnd-teams">
          {teamColumns.map((column) => (
            <DroppableMemberColumn
              key={column.containerId}
              column={column}
              canDrag={canDrag}
              statusContent={teamStatusContentByContainerId?.[column.containerId] ?? null}
              selectedUserIds={selectedUserIds}
              activeSearch={activeSearch}
              toMemberDomId={toMemberDomId}
              onSelectMember={onSelectMember}
              onOpenMember={onOpenMember}
              onCopyTeamMentions={onCopyTeamMentions}
              onToggleLock={onToggleLock}
              onMoveTeam={onMoveTeam}
              onDeleteTeam={onDeleteTeam}
              isLocked={lockedTeamIds?.has(column.containerId)}
              teamIndex={teamIndexMap?.get(column.containerId)}
              teamCount={teamCount}
              onDraftNameChange={onDraftNameChange}
              isDragActive={Boolean(activeDragItem)}
              absentUserIds={absentUserIds}
            />
          ))}
        </Stack>
      </div>
    </div>
  );
}

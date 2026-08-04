import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Menu,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  BoltIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  DotsIcon,
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
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import {
  resolveClassCatalogItem,
  type ResolvedClassCatalogItem,
  useClassCatalogStore,
} from "@portal/stores/class-catalog";

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
  classItem: ResolvedClassCatalogItem;
  dragDisabled: boolean;
  isMatched: boolean;
  isAbsent: boolean;
  userId: string;
  onOpenMember?: (userId: string) => void;
};

const DraggableMemberCard = memo(function DraggableMemberCard({
  itemId,
  domId,
  username,
  power,
  classItem,
  dragDisabled,
  isMatched,
  isAbsent,
  userId,
  onOpenMember,
}: DraggableMemberCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: itemId,
    disabled: dragDisabled,
  });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({
    id: itemId,
    disabled: dragDisabled,
  });
  const { t } = useTranslation("guild-war");
  const [holding, setHolding] = useState(false);
  const holdTimerRef = useRef<number | null>(null);

  const setNodeRef = useCallback((node: HTMLButtonElement | null) => {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }, [setDraggableNodeRef, setDroppableNodeRef]);

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
    if (dragDisabled) {
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
  }, [dragDisabled, listeners]);

  const style: CSSProperties = isDragging
    ? { opacity: 0, pointerEvents: "none" }
    : {};
  const interactionDisabled = dragDisabled && !onOpenMember;
  const classNames = [
    "guild-war-member-card",
    interactionDisabled ? "guild-war-member-card--disabled" : "",
    isMatched ? "guild-war-member-card--matched" : "",
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
      onClick={onOpenMember ? handleOpen : undefined}
      aria-label={t(
        onOpenMember ? "active.aria.openMember" : "active.aria.dragMember",
        { username },
      )}
      disabled={interactionDisabled}
      {...(dragDisabled ? {} : attributes)}
      {...(dragDisabled ? {} : listeners)}
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
            <Badge color="orange" size="xs" variant="light" style={{ flexShrink: 0 }}>
              {t("active.absent")}
            </Badge>
          ) : null}
        </Group>
        <Group gap={8} wrap="nowrap">
          <ClassIdentity item={classItem} />
          <Group gap={4} wrap="nowrap">
            <BoltIcon size={12} aria-hidden="true" />
            <Text component="span" c="dimmed" size="xs">{power}</Text>
          </Group>
        </Group>
      </Stack>
    </button>
  );
});

function ClassIdentity({ item }: { item: ResolvedClassCatalogItem }) {
  return (
    <span
      className="guild-war-class-identity"
      style={{ "--class-color": item.color } as CSSProperties}
    >
      <ClassIcon item={item} size={18} />
      <span className="guild-war-class-identity__label">{item.label}</span>
    </span>
  );
}

type DroppableMemberColumnProps = {
  column: DragMemberColumn;
  canDrag: boolean;
  statusContent?: ReactNode;
  activeSearch: string;
  toMemberDomId: (itemId: string) => string;
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
  activeSearch,
  toMemberDomId,
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
  const classCatalog = useClassCatalogStore((state) => state.items);
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
      else if (sortBy === "class") {
        cmp = resolveClassCatalogItem(a.class, classCatalog).label.localeCompare(
          resolveClassCatalogItem(b.class, classCatalog).label,
        );
      }
      else if (sortBy === "power") cmp = a.power - b.power;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [classCatalog, column.members, sortBy, sortDir]);

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
    <Paper
      withBorder
      radius="md"
      className={`guild-war-column-card${isOver ? " guild-war-column-card--over" : ""}${isDragActive && !isOver ? " guild-war-column-card--drag-active" : ""}`}
      style={{ overflow: "visible" }}
    >
      <div ref={setNodeRef} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <Stack gap={8} mb="sm" className="guild-war-column-header">
          <Group gap={8} justify="space-between" wrap="wrap">
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
              ) : isTeamColumn && onDraftNameChange ? (
                <UnstyledButton
                  className="guild-war-team-name-trigger"
                  onClick={() => setIsEditingName(true)}
                  aria-label={t("active.aria.editTeamName", { teamName: column.title })}
                >
                  <Text size="sm" fw={600} truncate>
                    {column.title}
                  </Text>
                </UnstyledButton>
              ) : (
                <Text size="sm" fw={600} truncate>
                  {column.title}
                </Text>
              )}
              <Badge size="sm" variant="default">{column.members.length}</Badge>
              {column.locked ? (
                <Badge color="red" size="sm">{t("active.locked")}</Badge>
              ) : null}
            </Group>
            <Group
              gap={4}
              justify="flex-end"
              wrap="nowrap"
              className="guild-war-column-actions"
            >
              {isTeamColumn && onToggleLock ? (
                <Tooltip label={isLocked ? t("hovercard.unlock.title") : t("hovercard.lock.title")}>
                  <ActionIcon
                    size={44}
                    variant={isLocked ? "light" : "subtle"}
                    color={isLocked ? "red" : undefined}
                    onClick={() => onToggleLock(column.containerId)}
                    aria-label={isLocked ? t("active.teamSetup.locked") : t("active.teamSetup.open")}
                  >
                    {isLocked ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
                  </ActionIcon>
                </Tooltip>
              ) : null}
              {isTeamColumn && onCopyTeamMentions ? (
                <Tooltip label={t("hovercard.copyTeam.title")}>
                  <ActionIcon
                    size={44}
                    variant="subtle"
                    onClick={() => onCopyTeamMentions(column.containerId)}
                    aria-label={t("active.teamCopied")}
                  >
                    <CopyIcon size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              {isPoolColumn && onAddToPool ? (
                <Tooltip label={t("hovercard.addToPool.title")}>
                  <ActionIcon size={44} variant="subtle" onClick={onAddToPool} aria-label={t("active.addToPool")}>
                    <UserPlusIcon size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Tooltip label={t("active.aria.columnActions")}>
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      aria-label={t("active.aria.columnActions")}
                    >
                      <DotsIcon size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<UserIcon size={14} />}
                    rightSection={sortBy === "username" ? (sortDir === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />) : null}
                    onClick={() => toggleSort("username")}
                  >
                    {t("active.sort.username")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<ShieldIcon size={14} />}
                    rightSection={sortBy === "class" ? (sortDir === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />) : null}
                    onClick={() => toggleSort("class")}
                  >
                    {t("active.sort.class")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<BoltIcon size={14} />}
                    rightSection={sortBy === "power" ? (sortDir === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />) : null}
                    onClick={() => toggleSort("power")}
                  >
                    {t("active.sort.power")}
                  </Menu.Item>
                  {isTeamColumn && onMoveTeam ? (
                    <>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<ChevronUpIcon size={14} />}
                        onClick={() => onMoveTeam(column.containerId, "up")}
                        disabled={teamIndex === 0}
                      >
                        {t("active.teamSetup.moveUp")}
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<ChevronDownIcon size={14} />}
                        onClick={() => onMoveTeam(column.containerId, "down")}
                        disabled={teamIndex === (teamCount ?? 1) - 1}
                      >
                        {t("active.teamSetup.moveDown")}
                      </Menu.Item>
                    </>
                  ) : null}
                  {isTeamColumn && onDeleteTeam ? (
                    <>
                      <Menu.Divider />
                      <Menu.Item
                        color="red"
                        leftSection={<TrashIcon size={14} />}
                        onClick={() => onDeleteTeam(column.containerId)}
                      >
                        {t("menu.team.delete")}
                      </Menu.Item>
                    </>
                  ) : null}
                </Menu.Dropdown>
              </Menu>
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
              classItem={resolveClassCatalogItem(member.class, classCatalog)}
              userId={member.userId}
              dragDisabled={!canDrag || column.locked}
              isAbsent={absentUserIds?.has(member.userId) ?? false}
              isMatched={
                activeSearch.trim().length > 0
                && `${member.username} ${member.class} ${resolveClassCatalogItem(member.class, classCatalog).label} ${member.power}`
                  .toLowerCase()
                  .includes(activeSearch.toLowerCase())
              }
              onOpenMember={onOpenMember}
            />
          ))}
        </div>
      </div>
    </Paper>
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
  const classCatalog = useClassCatalogStore((state) => state.items);
  const classItem = resolveClassCatalogItem(activeDragItem.class, classCatalog);
  return (
    <Card withBorder p="sm">
      <Stack gap={2}>
        <Text size="sm" fw={500}>{activeDragItem.username}</Text>
        <Group gap={8} wrap="nowrap">
          <ClassIdentity item={classItem} />
          <Group gap={4} wrap="nowrap">
            <BoltIcon size={12} aria-hidden="true" />
            <Text component="span" c="dimmed" size="xs">{activeDragItem.power}</Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

type GuildWarDragBoardLayoutProps = {
  view?: "all" | "pool" | "teams";
  poolColumn?: DragMemberColumn;
  teamColumns: DragMemberColumn[];
  canDrag: boolean;
  activeSearch: string;
  activeDragItem: ActiveDragItem | null;
  toMemberDomId: (itemId: string) => string;
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
  readinessContent?: ReactNode;
};

export function GuildWarDragBoardLayout({
  view = "all",
  poolColumn,
  teamColumns,
  canDrag,
  activeSearch,
  activeDragItem,
  toMemberDomId,
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
  readinessContent,
}: GuildWarDragBoardLayoutProps) {
  return (
    <div className={`guild-war-dnd-split ${disabled ? "guild-war-dnd-split--disabled" : ""}`}>
      {view !== "teams" ? <div className="guild-war-dnd-pool">
        <div className="guild-war-column-card-wrap">
          {poolColumn ? (
            <DroppableMemberColumn
              column={poolColumn}
              canDrag={canDrag}
              statusContent={activePoolStatus}
              activeSearch={activeSearch}
              toMemberDomId={toMemberDomId}
              onOpenMember={onOpenMember}
              onAddToPool={onAddToPool}
              isDragActive={Boolean(activeDragItem)}
              absentUserIds={absentUserIds}
            />
          ) : null}
          <TrashDropZone visible={Boolean(activeDragItem)} />
        </div>
      </div> : null}

      {view !== "pool" ? <div className="guild-war-dnd-teams-wrap">
        <div className="guild-war-dnd-teams">
          {teamColumns.map((column) => (
            <DroppableMemberColumn
              key={column.containerId}
              column={column}
              canDrag={canDrag}
              statusContent={teamStatusContentByContainerId?.[column.containerId] ?? null}
              activeSearch={activeSearch}
              toMemberDomId={toMemberDomId}
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
        </div>
      </div> : null}

      {view === "all" && readinessContent ? (
        <div className="guild-war-dnd-readiness">{readinessContent}</div>
      ) : null}
    </div>
  );
}

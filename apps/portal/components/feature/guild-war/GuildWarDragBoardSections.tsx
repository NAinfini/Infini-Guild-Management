import type { ClassCatalogItem } from "@guild/shared";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import {
  BoltIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  DotsIcon,
  LockIcon,
  PencilIcon,
  ShieldIcon,
  TrashIcon,
  UnlockIcon,
  UserIcon,
  UserPlusIcon,
} from "@portal/components/icons";
import { IconGripVertical } from "@tabler/icons-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import type {
  DragMemberColumn,
  DragMemberItem,
} from "../../../hooks/guild-war/useGuildWarDragData";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";

/* 列与成员的形状由产出它的 useGuildWarDragData 定义，这里只转出去给既有的
   引用方用。之前两边各写了一份同名类型，加字段时只会改到其中一份。 */
export type { DragMemberColumn, DragMemberItem };

export type ActiveDragItem = {
  userId: string;
  display_name: string;
  power: number;
  class: string;
  subtitle: string;
  avatarMediaId: string | null;
};

const DRAG_HOLD_MS = 150;

type MemberRowCellsProps = {
  display_name: string;
  power: number;
  classItem: ClassCatalogItem;
  avatarMediaId: string | null;
  isAbsent?: boolean;
  isDraggable?: boolean;
};

/*
 * 一行的格子内容。拖拽行和拖拽时跟着光标的影子共用这一份 —— 影子就是「你拿起来的
 * 那一行」，两处各画一遍的话，改了行就得记得同步改影子。
 *
 * 头像用花名册那只 MemberRoleAvatar：职能圈关掉（职能名就在右边两格，圈圈是重复），
 * 悬浮卡也关掉（它内部是 UnstyledButton，套进本行这个 button 里就是按钮套按钮）。
 */
function MemberRowCells({
  display_name,
  power,
  classItem,
  avatarMediaId,
  isAbsent = false,
  isDraggable = true,
}: MemberRowCellsProps) {
  const { t } = useTranslation("guild-war");

  return (
    <>
      <span className="guild-war-member-card__rail" style={{ "--class-color": classItem.color } as CSSProperties} aria-hidden="true" />
      {/*
        * 把手只是提示，不是唯一入口：整行都能拿起来，所以它不是按钮——行本身就是按钮，
        * 里面再套一个按钮既非法也会让人以为只有这一小块能拖。锁定的队伍不画，画了就是
        * 骗人。这一格永远占位，有没有把手都不会让后面几格错位。
        */}
      <span className="guild-war-member-card__grip" aria-hidden="true">
        {isDraggable ? <IconGripVertical size={14} /> : null}
      </span>
      <MemberRoleAvatar
        user={{ display_name }}
        profile={{ classes: [classItem.id], power, avatar_media_id: avatarMediaId }}
        size={22}
        withTooltip={false}
        withClassCircles={false}
      />
      <span className="guild-war-member-card__name">
        <span className="guild-war-member-card__username">{display_name}</span>
        {isAbsent ? (
          <Badge variant="secondary" className="guild-war-member-card__absent">
            {t("active.absent")}
          </Badge>
        ) : null}
      </span>
      <ClassIdentity item={classItem} />
      <span className="guild-war-member-card__power tabular-nums">{power.toLocaleString()}</span>
    </>
  );
}

type DraggableMemberCardProps = {
  itemId: string;
  domId: string;
  display_name: string;
  power: number;
  classItem: ClassCatalogItem;
  avatarMediaId: string | null;
  dragDisabled: boolean;
  isMatched: boolean;
  isAbsent: boolean;
  userId: string;
  onOpenMember?: (userId: string) => void;
};

const DraggableMemberCard = memo(function DraggableMemberCard({
  itemId,
  domId,
  display_name,
  power,
  classItem,
  avatarMediaId,
  dragDisabled,
  isMatched,
  isAbsent,
  userId,
  onOpenMember,
}: DraggableMemberCardProps) {
  /*
   * 行只是拖拽源，不是投放目标：投放的单位是「哪一列」，行落在列的任何位置结果都一样。
   * 行上再挂一个 droppable，pointerWithin 会挑中心离指针更近的那个，于是指针压在某一行
   * 上时命中的是行、压在名册下方空白处命中的是列——同一次拖拽里列的高亮时有时无。
   */
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: itemId,
    disabled: dragDisabled,
  });
  const { t } = useTranslation("guild-war");
  const [holding, setHolding] = useState(false);
  const holdTimerRef = useRef<number | null>(null);

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
        { display_name },
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
      <MemberRowCells
        display_name={display_name}
        power={power}
        classItem={classItem}
        avatarMediaId={avatarMediaId}
        isAbsent={isAbsent}
        isDraggable={!dragDisabled}
      />
    </button>
  );
});

type MemberSortField = "display_name" | "class" | "power";

type SortHeadProps = {
  field: MemberSortField;
  label: string;
  sortBy: MemberSortField | null;
  sortDir: "asc" | "desc";
  onToggle: (field: MemberSortField) => void;
  align?: "start" | "end";
};

/*
 * 列头和「⋯」菜单里的排序项是同一个 toggleSort 的两个入口，共用同一份排序状态。
 * 菜单留着是因为列头在窄屏会被藏掉，那时仍要有地方排序。
 *
 * 不挂 role="columnheader"/aria-sort：行是可拖拽的 button，整块并不是 table，
 * 补一半的表格角色比不补更难被辅助技术解释。排序方向由按钮内的箭头表达。
 */
function SortHead({ field, label, sortBy, sortDir, onToggle, align = "start" }: SortHeadProps) {
  const isActive = sortBy === field;

  return (
    <button
      type="button"
      className={`guild-war-column-head__cell${isActive ? " guild-war-column-head__cell--active" : ""}`}
      data-align={align}
      onClick={() => onToggle(field)}
    >
      <span className="guild-war-column-head__label">{label}</span>
      {isActive
        ? (sortDir === "asc" ? <ChevronUpIcon size={11} /> : <ChevronDownIcon size={11} />)
        : null}
    </button>
  );
}

function ClassIdentity({ item }: { item: ClassCatalogItem }) {
  return (
    <span
      className="guild-war-class-identity"
      style={{ "--class-color": item.color } as CSSProperties}
    >
      <ClassIcon item={item} size={16} />
      <span className="guild-war-class-identity__label">{item.label}</span>
    </span>
  );
}

type DroppableMemberColumnProps = {
  column: DragMemberColumn;
  canDrag: boolean;
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
  onEditTeam?: (containerId: string) => void;
  isDragActive?: boolean;
  absentUserIds?: Set<string>;
};

export function DroppableMemberColumn({
  column,
  canDrag,
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
  onEditTeam,
  isDragActive,
  absentUserIds,
}: DroppableMemberColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `container:${column.containerId}`,
  });
  const { t } = useTranslation("guild-war");
  const classCatalog = useClassCatalog();
  const isPoolColumn = column.containerId === "pool";
  const isTeamColumn = !isPoolColumn;
  const [sortBy, setSortBy] = useState<MemberSortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedMembers = useMemo(() => {
    if (!sortBy) {
      return column.members;
    }
    return [...column.members].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "display_name") cmp = a.display_name.localeCompare(b.display_name);
      else if (sortBy === "class") {
        cmp = resolveClassCatalogItem(a.class, classCatalog).label.localeCompare(
          resolveClassCatalogItem(b.class, classCatalog).label,
        );
      }
      else if (sortBy === "power") cmp = a.power - b.power;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [classCatalog, column.members, sortBy, sortDir]);

  const toggleSort = (field: MemberSortField) => {
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

  const totalPower = useMemo(
    () => column.members.reduce((sum, member) => sum + member.power, 0),
    [column.members],
  );

  return (
    <Card
      className={`guild-war-column-card${isOver ? " guild-war-column-card--over" : ""}${isDragActive && !isOver ? " guild-war-column-card--drag-active" : ""}`}
    >
      <div ref={setNodeRef} className="guild-war-column-card__body">
        <div className="guild-war-column-header">
          <div className="guild-war-column-header__row">
            <div className="guild-war-column-header__identity">
              <strong className="guild-war-column-header__title" title={column.title}>
                {column.title}
              </strong>
              <Badge variant="outline" className="guild-war-column-count">
                {column.members.length}
              </Badge>
              {column.locked ? (
                <Badge variant="destructive">{t("active.locked")}</Badge>
              ) : null}
            </div>
            <div className="guild-war-column-actions">
              {/* 总战力挂在列头，不另起一行汇总：一整行只为了一个数，等于把空白搬进卡片里。 */}
              {column.members.length > 0 ? (
                <div className="guild-war-column-total">
                  <span className="guild-war-column-total__label">{t("active.totalPower")}</span>
                  <span className="guild-war-column-total__value tabular-nums">
                    {totalPower.toLocaleString()}
                  </span>
                  <span className="guild-war-column-total__average tabular-nums">
                    {t("active.averagePower", {
                      value: Math.round(totalPower / column.members.length).toLocaleString(),
                    })}
                  </span>
                </div>
              ) : null}
              {/* 队名和备注都在这道门后面。以前备注常驻在列头下面，一整行输入框写满全场，
                  而队名要点中标题才知道能改——两条改法两个入口，还占着名册的高度。 */}
              {isTeamColumn && onEditTeam ? (
                <Tooltip>
                  <TooltipTrigger render={<Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="guild-war-column-action"
                    onClick={() => onEditTeam(column.containerId)}
                    aria-label={t("active.teamSetup.edit")}
                  />}>
                    <PencilIcon size={16} />
                  </TooltipTrigger>
                  <TooltipContent>{t("active.teamSetup.edit")}</TooltipContent>
                </Tooltip>
              ) : null}
              {isTeamColumn && onToggleLock ? (
                <Tooltip>
                  <TooltipTrigger render={<Button
                    type="button"
                    size="icon"
                    variant={isLocked ? "destructive" : "ghost"}
                    className="guild-war-column-action"
                    onClick={() => onToggleLock(column.containerId)}
                    aria-label={isLocked ? t("active.teamSetup.locked") : t("active.teamSetup.open")}
                  />}>
                    {isLocked ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
                  </TooltipTrigger>
                  <TooltipContent>{isLocked ? t("hovercard.unlock.title") : t("hovercard.lock.title")}</TooltipContent>
                </Tooltip>
              ) : null}
              {isTeamColumn && onCopyTeamMentions ? (
                <Tooltip>
                  <TooltipTrigger render={<Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="guild-war-column-action"
                    onClick={() => onCopyTeamMentions(column.containerId)}
                    aria-label={t("active.teamCopied")}
                  />}>
                    <CopyIcon size={16} />
                  </TooltipTrigger>
                  <TooltipContent>{t("hovercard.copyTeam.title")}</TooltipContent>
                </Tooltip>
              ) : null}
              {isPoolColumn && onAddToPool ? (
                <Tooltip>
                  <TooltipTrigger render={<Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="guild-war-column-action"
                    onClick={onAddToPool}
                    aria-label={t("active.addToPool")}
                  />}>
                    <UserPlusIcon size={16} />
                  </TooltipTrigger>
                  <TooltipContent>{t("hovercard.addToPool.title")}</TooltipContent>
                </Tooltip>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="guild-war-column-action"
                  aria-label={t("active.aria.columnActions")}
                  title={t("active.aria.columnActions")}
                />}>
                  <DotsIcon size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => toggleSort("display_name")}>
                    <UserIcon size={14} />
                    <span>{t("active.sort.display_name")}</span>
                    {sortBy === "display_name" ? (
                      <span className="guild-war-column-menu__indicator">
                        {sortDir === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleSort("class")}>
                    <ShieldIcon size={14} />
                    <span>{t("active.sort.class")}</span>
                    {sortBy === "class" ? (
                      <span className="guild-war-column-menu__indicator">
                        {sortDir === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleSort("power")}>
                    <BoltIcon size={14} />
                    <span>{t("active.sort.power")}</span>
                    {sortBy === "power" ? (
                      <span className="guild-war-column-menu__indicator">
                        {sortDir === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                  {isTeamColumn && onMoveTeam ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onMoveTeam(column.containerId, "up")}
                        disabled={teamIndex === 0}
                      >
                        <ChevronUpIcon size={14} />
                        {t("active.teamSetup.moveUp")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onMoveTeam(column.containerId, "down")}
                        disabled={teamIndex === (teamCount ?? 1) - 1}
                      >
                        <ChevronDownIcon size={14} />
                        {t("active.teamSetup.moveDown")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {isTeamColumn && onDeleteTeam ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDeleteTeam(column.containerId)}
                      >
                        <TrashIcon size={14} />
                        {t("menu.team.delete")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        {/* 列头与成员行共用 --guild-war-row-columns 那套栅格（见 GuildWarPage.css），
            所以标签永远压在它标注的那一格上；前三格是职业色条、把手和头像，无标签。 */}
        {column.members.length > 0 ? (
          <div className="guild-war-column-head">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <SortHead
              field="display_name"
              label={t("active.column.member")}
              sortBy={sortBy}
              sortDir={sortDir}
              onToggle={toggleSort}
            />
            <SortHead
              field="class"
              label={t("active.column.class")}
              sortBy={sortBy}
              sortDir={sortDir}
              onToggle={toggleSort}
            />
            <SortHead
              field="power"
              label={t("active.column.power")}
              sortBy={sortBy}
              sortDir={sortDir}
              onToggle={toggleSort}
              align="end"
            />
          </div>
        ) : null}
        <div className="guild-war-column-stack">
          {sortedMembers.map((member) => (
            <DraggableMemberCard
              key={member.itemId}
              itemId={member.itemId}
              domId={toMemberDomId(member.itemId)}
              display_name={member.display_name}
              power={member.power}
              classItem={resolveClassCatalogItem(member.class, classCatalog)}
              avatarMediaId={member.avatarMediaId}
              userId={member.userId}
              dragDisabled={!canDrag || column.locked}
              isAbsent={absentUserIds?.has(member.userId) ?? false}
              isMatched={
                activeSearch.trim().length > 0
                && `${member.display_name} ${member.class} ${resolveClassCatalogItem(member.class, classCatalog).label} ${member.power}`
                  .toLowerCase()
                  .includes(activeSearch.toLowerCase())
              }
              onOpenMember={onOpenMember}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

type TrashDropZoneProps = {
  visible: boolean;
};

export function TrashDropZone({ visible }: TrashDropZoneProps) {
  const { t } = useTranslation("guild-war");
  /* 藏起来的时候必须停用，不能只靠不可见：投放判定量的是矩形，
     visibility:hidden 的元素照样有矩形，落在池子底边就会被当成「移出这场战」。 */
  const { setNodeRef, isOver } = useDroppable({ id: "trash-zone", disabled: !visible });

  return (
    <div
      ref={setNodeRef}
      className={`guild-war-trash-zone ${visible ? "guild-war-trash-zone--visible" : ""} ${isOver ? "guild-war-trash-zone--over" : ""}`}
    >
      <TrashIcon size={18} />
      <span>{t("active.trashZone")}</span>
    </div>
  );
}

type GuildWarDragOverlayCardProps = {
  activeDragItem: ActiveDragItem;
};

export function GuildWarDragOverlayCard({ activeDragItem }: GuildWarDragOverlayCardProps) {
  const classCatalog = useClassCatalog();
  const classItem = resolveClassCatalogItem(activeDragItem.class, classCatalog);
  /* 影子复用成员行本身的栅格；--overlay 只补上抬起时的底和投影。 */
  return (
    <div className="guild-war-member-card guild-war-member-card--overlay">
      <MemberRowCells
        display_name={activeDragItem.display_name}
        power={activeDragItem.power}
        classItem={classItem}
        avatarMediaId={activeDragItem.avatarMediaId}
      />
    </div>
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
  disabled?: boolean;
  onCopyTeamMentions?: (containerId: string) => void;
  onToggleLock?: (containerId: string) => void;
  onMoveTeam?: (containerId: string, direction: "up" | "down") => void;
  onDeleteTeam?: (containerId: string) => void;
  lockedTeamIds?: Set<string>;
  teamCount?: number;
  teamIndexMap?: Map<string, number>;
  onAddToPool?: () => void;
  onEditTeam?: (containerId: string) => void;
  absentUserIds?: Set<string>;
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
  disabled,
  onCopyTeamMentions,
  onToggleLock,
  onMoveTeam,
  onDeleteTeam,
  lockedTeamIds,
  teamCount,
  teamIndexMap,
  onAddToPool,
  onEditTeam,
  absentUserIds,
}: GuildWarDragBoardLayoutProps) {
  return (
    <div className={`guild-war-dnd-split ${disabled ? "guild-war-dnd-split--disabled" : ""}`}>
      {view !== "teams" ? <div className="guild-war-dnd-pool">
        <div className="guild-war-column-card-wrap">
          {poolColumn ? (
            <DroppableMemberColumn
              column={poolColumn}
              canDrag={canDrag}
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
              onEditTeam={onEditTeam}
              isDragActive={Boolean(activeDragItem)}
              absentUserIds={absentUserIds}
            />
          ))}
        </div>
      </div> : null}
    </div>
  );
}

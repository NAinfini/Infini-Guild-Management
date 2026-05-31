import { DndContext, DragOverlay, pointerWithin, type DragEndEvent, type DragStartEvent, type Modifier } from "@dnd-kit/core";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import {
  GuildWarDragBoardLayout,
  GuildWarDragOverlayCard,
  type ActiveDragItem,
  type DragMemberColumn,
} from "./GuildWarDragBoardSections";

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
  onCopyTeamMentions?: (containerId: string) => void;
  onToggleLock?: (containerId: string) => void;
  onMoveTeam?: (containerId: string, direction: "up" | "down") => void;
  onDeleteTeam?: (containerId: string) => void;
  lockedTeamIds?: Set<string>;
  teamCount?: number;
  teamIndexMap?: Map<string, number>;
  onAddToPool?: () => void;
  onDraftNameChange?: (containerId: string, value: string) => void;
};

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
  onCopyTeamMentions,
  onToggleLock,
  onMoveTeam,
  onDeleteTeam,
  lockedTeamIds,
  teamCount,
  teamIndexMap,
  onAddToPool,
  onDraftNameChange,
}: GuildWarDragBoardProps) {
  const { t } = useTranslation("guild-war");
  const poolColumn = dragColumns.find((column) => column.containerId === "pool");
  const teamColumns = dragColumns.filter((column) => column.containerId !== "pool");

  if (!poolColumn && teamColumns.length === 0) {
    return <EmptyState title={emptyText} description={t("active.emptyBoard")} />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
    >
      <GuildWarDragBoardLayout
        poolColumn={poolColumn}
        teamColumns={teamColumns}
        canDrag={canDrag}
        selectedUserIds={selectedUserIds}
        activeSearch={activeSearch}
        activeDragItem={activeDragItem}
        toMemberDomId={toMemberDomId}
        onSelectMember={onSelectMember}
        onOpenMember={onOpenMember}
        activePoolStatus={activePoolStatus}
        teamStatusContentByContainerId={teamStatusContentByContainerId}
        disabled={disabled}
        onCopyTeamMentions={onCopyTeamMentions}
        onToggleLock={onToggleLock}
        onMoveTeam={onMoveTeam}
        onDeleteTeam={onDeleteTeam}
        lockedTeamIds={lockedTeamIds}
        teamCount={teamCount}
        teamIndexMap={teamIndexMap}
        onAddToPool={onAddToPool}
        onDraftNameChange={onDraftNameChange}
      />

      <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
        {activeDragItem ? <GuildWarDragOverlayCard activeDragItem={activeDragItem} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

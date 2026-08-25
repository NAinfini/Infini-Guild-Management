import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { Button } from "@portal/components/ui/button";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import {
  GuildWarDragBoardLayout,
  GuildWarDragOverlayCard,
  type ActiveDragItem,
  type DragMemberColumn,
} from "./GuildWarDragBoardSections";
import { guildWarCollisionDetection, guildWarMeasuring } from "./guildWarDragGeometry";

type GuildWarDragBoardProps = {
  dragColumns: DragMemberColumn[];
  canDrag: boolean;
  emptyText: string;
  activeSearch: string;
  activeDragItem: ActiveDragItem | null;
  toMemberDomId: (itemId: string) => string;
  sensors: NonNullable<ComponentProps<typeof DndContext>["sensors"]>;
  onOpenMember?: (userId: string) => void;
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
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
  activeSearch,
  activeDragItem,
  toMemberDomId,
  sensors,
  onOpenMember,
  onDragStart,
  onDragCancel,
  onDragEnd,
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
}: GuildWarDragBoardProps) {
  const { t } = useTranslation("guild-war");
  const poolColumn = dragColumns.find((column) => column.containerId === "pool");
  const teamColumns = dragColumns.filter((column) => column.containerId !== "pool");

  if (!poolColumn && teamColumns.length === 0) {
    return (
      <EmptyState
        title={emptyText}
        description={t("active.emptyBoard")}
        actions={onAddToPool ? (
          <Button onClick={onAddToPool}>{t("active.addToPool")}</Button>
        ) : undefined}
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={guildWarCollisionDetection}
      measuring={guildWarMeasuring}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
    >
      <div className="guild-war-desktop-flow">
        <GuildWarDragBoardLayout
          poolColumn={poolColumn}
          teamColumns={teamColumns}
          canDrag={canDrag}
          activeSearch={activeSearch}
          activeDragItem={activeDragItem}
          toMemberDomId={toMemberDomId}
          onOpenMember={onOpenMember}
          disabled={disabled}
          onCopyTeamMentions={onCopyTeamMentions}
          onToggleLock={onToggleLock}
          onMoveTeam={onMoveTeam}
          onDeleteTeam={onDeleteTeam}
          lockedTeamIds={lockedTeamIds}
          teamCount={teamCount}
          teamIndexMap={teamIndexMap}
          onAddToPool={onAddToPool}
          onEditTeam={onEditTeam}
          absentUserIds={absentUserIds}
        />
      </div>

      <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
        {activeDragItem ? <GuildWarDragOverlayCard activeDragItem={activeDragItem} /> : null}
      </DragOverlay>
    </DndContext>
  );
}


import {
  closestCenter,
  DndContext,
  DragOverlay,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { Badge, Button, Paper, Stack, Text } from "@mantine/core";
import type { ComponentProps, ReactNode } from "react";
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
  activeSearch: string;
  activeDragItem: ActiveDragItem | null;
  toMemberDomId: (itemId: string) => string;
  sensors: NonNullable<ComponentProps<typeof DndContext>["sensors"]>;
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
  absentUserIds?: Set<string>;
  teamsDirty?: boolean;
  saveTeamsPending?: boolean;
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

export const guildWarCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

export function GuildWarDragBoard({
  dragColumns,
  canDrag,
  emptyText,
  activePoolStatus,
  activeSearch,
  activeDragItem,
  toMemberDomId,
  sensors,
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
  absentUserIds,
  teamsDirty = false,
  saveTeamsPending = false,
}: GuildWarDragBoardProps) {
  const { t } = useTranslation("guild-war");
  const poolColumn = dragColumns.find((column) => column.containerId === "pool");
  const teamColumns = dragColumns.filter((column) => column.containerId !== "pool");
  const assignedCount = teamColumns.reduce((count, column) => count + column.members.length, 0);

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

  const readinessPanel = (
    <Paper
      component="aside"
      withBorder
      radius="md"
      p="var(--card-padding)"
      className="guild-war-readiness"
      aria-label={t("active.readiness.title")}
    >
      <div className="guild-war-readiness__header">
        <div>
          <Text size="xs" c="dimmed" fw={600}>{t("active.readiness.kicker")}</Text>
          <Text fw={700}>{t("active.readiness.title")}</Text>
        </div>
        <Badge color={saveTeamsPending ? "blue" : teamsDirty ? "orange" : "gray"} variant="light">
          {saveTeamsPending
            ? t("active.readiness.saving")
            : teamsDirty
              ? t("active.unsaved")
              : t("active.readiness.synced")}
        </Badge>
      </div>

      <dl className="guild-war-readiness__ledger">
        <ReadinessEntry label={t("active.readiness.assigned")} value={assignedCount} />
        <ReadinessEntry label={t("active.readiness.pool")} value={poolColumn?.members.length ?? 0} />
        <ReadinessEntry label={t("active.readiness.squads")} value={teamColumns.length} />
      </dl>

      <div className="guild-war-readiness__status" role="status">
        <span
          className={`guild-war-readiness__status-mark${teamsDirty || saveTeamsPending ? " guild-war-readiness__status-mark--dirty" : ""}`}
          aria-hidden="true"
        />
        <Text size="xs" c="dimmed">
          {saveTeamsPending
            ? t("active.readiness.saving")
            : teamsDirty
              ? t("active.readiness.pendingChanges")
              : t("active.readiness.noPendingChanges")}
        </Text>
      </div>
    </Paper>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={guildWarCollisionDetection}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
    >
      <Stack gap="sm" className="guild-war-desktop-flow">
        <GuildWarDragBoardLayout
          poolColumn={poolColumn}
          teamColumns={teamColumns}
          canDrag={canDrag}
          activeSearch={activeSearch}
          activeDragItem={activeDragItem}
          toMemberDomId={toMemberDomId}
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
          absentUserIds={absentUserIds}
          readinessContent={readinessPanel}
        />
      </Stack>

      <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
        {activeDragItem ? <GuildWarDragOverlayCard activeDragItem={activeDragItem} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function ReadinessEntry({ label, value }: { label: string; value: number }) {
  return (
    <div className="guild-war-readiness__entry">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}

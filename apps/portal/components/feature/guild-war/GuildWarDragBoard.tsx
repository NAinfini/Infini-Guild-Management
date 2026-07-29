import { DndContext, DragOverlay, pointerWithin, type DragEndEvent, type DragStartEvent, type Modifier } from "@dnd-kit/core";
import { Badge, Button, Group, Paper, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMemo, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
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
  absentUserIds?: Set<string>;
  onMoveSelected?: (targetContainerId: string) => void;
  onRemoveSelected?: () => void;
  teamsDirty?: boolean;
  saveTeamsPending?: boolean;
  onSaveTeams?: () => void;
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
  absentUserIds,
  onMoveSelected,
  onRemoveSelected,
  teamsDirty = false,
  saveTeamsPending = false,
  onSaveTeams,
}: GuildWarDragBoardProps) {
  const { t } = useTranslation("guild-war");
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const [mobileStep, setMobileStep] = useState<"pool" | "teams" | "status">("pool");
  const [mobileTarget, setMobileTarget] = useState<string | null>(null);
  const poolColumn = dragColumns.find((column) => column.containerId === "pool");
  const teamColumns = dragColumns.filter((column) => column.containerId !== "pool");
  const assignedCount = teamColumns.reduce((count, column) => count + column.members.length, 0);
  const moveTargets = useMemo(
    () => [
      ...(poolColumn ? [{ value: poolColumn.containerId, label: t("active.pool") }] : []),
      ...teamColumns
        .filter((column) => !column.locked)
        .map((column, index) => ({
          value: column.containerId,
          label: typeof column.title === "string"
            ? column.title
            : t("active.teamSetup.team", { index: index + 1 }),
        })),
    ],
    [poolColumn, t, teamColumns],
  );

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
      {isMobile ? (
        <Stack gap="sm" className="guild-war-mobile-flow">
          <Paper withBorder p="sm" className="guild-war-mobile-summary">
            <Group justify="space-between" align="center" wrap="wrap" gap="xs">
              <Stack gap={2}>
                <Text size="xs" c="dimmed">{t("active.mobile.summary")}</Text>
                <Text size="sm" fw={700}>
                  {t("active.mobile.summaryCounts", {
                    selected: selectedUserIds.size,
                    pool: poolColumn?.members.length ?? 0,
                    assigned: assignedCount,
                  })}
                </Text>
              </Stack>
              <Group gap="xs">
                <Badge color={teamsDirty ? "yellow" : "green"} variant="light">
                  {teamsDirty ? t("active.unsaved") : t("active.noUnsavedChanges")}
                </Badge>
                {onSaveTeams ? (
                  <Button
                    size="compact-sm"
                    onClick={onSaveTeams}
                    loading={saveTeamsPending}
                    disabled={!teamsDirty || saveTeamsPending}
                  >
                    {t("active.saveTeams")}
                  </Button>
                ) : null}
              </Group>
            </Group>
          </Paper>

          <SegmentedControl
            fullWidth
            value={mobileStep}
            onChange={(value) => setMobileStep(value as typeof mobileStep)}
            data={[
              { value: "pool", label: t("active.mobile.poolStep") },
              { value: "teams", label: t("active.mobile.teamsStep") },
              { value: "status", label: t("active.mobile.statusStep") },
            ]}
          />

          {canDrag && onMoveSelected && onRemoveSelected ? (
            <Paper withBorder p="sm" className="guild-war-mobile-move">
              <Select
                label={t("active.mobile.moveTo")}
                placeholder={t("active.mobile.chooseDestination")}
                data={moveTargets}
                value={mobileTarget}
                onChange={setMobileTarget}
                allowDeselect={false}
              />
              <Group grow>
                <Button
                  variant="default"
                  disabled={selectedUserIds.size === 0 || !mobileTarget}
                  onClick={() => {
                    if (mobileTarget) onMoveSelected(mobileTarget);
                  }}
                >
                  {t("active.mobile.moveSelected", { count: selectedUserIds.size })}
                </Button>
                <Button
                  color="red"
                  variant="light"
                  disabled={selectedUserIds.size === 0}
                  onClick={onRemoveSelected}
                >
                  {t("active.mobile.removeSelected")}
                </Button>
              </Group>
            </Paper>
          ) : null}

          {mobileStep === "status" ? (
            <Stack gap="sm" className="guild-war-mobile-status">
              {teamColumns.map((column) => (
                <Paper key={column.containerId} withBorder p="md">
                  <Group justify="space-between" mb="xs">
                    <Text fw={700}>{column.title}</Text>
                    <Group gap="xs">
                      <Badge variant="default">{column.members.length}</Badge>
                      {column.locked ? <Badge color="red">{t("active.locked")}</Badge> : null}
                    </Group>
                  </Group>
                  {teamStatusContentByContainerId?.[column.containerId] ?? (
                    <Text size="sm" c="dimmed">{t("active.mobile.statusEmpty")}</Text>
                  )}
                </Paper>
              ))}
            </Stack>
          ) : (
            <GuildWarDragBoardLayout
              view={mobileStep}
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
            />
          )}
        </Stack>
      ) : (
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
          absentUserIds={absentUserIds}
        />
      )}

      <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
        {activeDragItem ? <GuildWarDragOverlayCard activeDragItem={activeDragItem} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

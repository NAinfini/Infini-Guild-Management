import { Group, Select, Text } from "@mantine/core";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";

type Option = {
  value: string;
  label: string;
};

type GuildWarMoveMemberCardProps = {
  title: string;
  selectedMoveUserId: string;
  selectedMoveTarget: string;
  moveCandidates: Option[];
  moveTargetOptions: Option[];
  memberPlaceholder: string;
  targetPlaceholder: string;
  moveLabel: string;
  movePending: boolean;
  moveDisabled: boolean;
  onSelectedMoveUserIdChange: (value: string) => void;
  onSelectedMoveTargetChange: (value: string) => void;
  onMove: () => void;
};

export function GuildWarMoveMemberCard({
  title,
  selectedMoveUserId,
  selectedMoveTarget,
  moveCandidates,
  moveTargetOptions,
  memberPlaceholder,
  targetPlaceholder,
  moveLabel,
  movePending,
  moveDisabled,
  onSelectedMoveUserIdChange,
  onSelectedMoveTargetChange,
  onMove,
}: GuildWarMoveMemberCardProps) {
  return (
    <InfiniCard>
      <div style={{ padding: "1.2rem" }}>
      <Group gap={10} wrap="wrap">
        <Text fw={600}>{title}</Text>
        <Select
          style={{ width: 280 }}
          value={selectedMoveUserId || null}
          placeholder={memberPlaceholder}
          aria-label="Select member to move"
          onChange={(value) => onSelectedMoveUserIdChange(value ?? "")}
          data={moveCandidates}
        />
        <Select
          style={{ width: 220 }}
          value={selectedMoveTarget || null}
          placeholder={targetPlaceholder}
          aria-label="Select destination team"
          onChange={(value) => onSelectedMoveTargetChange(value ?? "")}
          data={moveTargetOptions}
        />
        <MotionButton type="primary" onClick={onMove} loading={movePending} disabled={moveDisabled}>
          {moveLabel}
        </MotionButton>
      </Group>
      </div>
    </InfiniCard>
  );
}


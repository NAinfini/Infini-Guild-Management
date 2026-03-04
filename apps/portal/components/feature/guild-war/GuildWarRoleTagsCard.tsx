import { Badge, Button, Group, Select, Stack, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";

type ActiveTeamMember = {
  user_id: string;
  role_tag: string | null;
};

type GuildWarRoleTagsCardProps = {
  selectedRoleUserId: string;
  selectedRoleMember: ActiveTeamMember | null;
  activeTeamMembers: ActiveTeamMember[];
  roleTagPresets: readonly string[];
  canAssignRoleTag: boolean;
  roleTagPending: boolean;
  onSelectedRoleUserIdChange: (value: string) => void;
  onAssignRoleTag: (tag: string | null) => void;
};

export function GuildWarRoleTagsCard({
  selectedRoleUserId,
  selectedRoleMember,
  activeTeamMembers,
  roleTagPresets,
  canAssignRoleTag,
  roleTagPending,
  onSelectedRoleUserIdChange,
  onAssignRoleTag,
}: GuildWarRoleTagsCardProps) {
  return (
    <InfiniCard>
      <div style={{ padding: "1.2rem" }}>
      <Stack gap={10}>
        <Text fw={600}>Role Tags</Text>
        <Group gap={8} wrap="wrap">
          <Select
            style={{ width: 320 }}
            value={selectedRoleUserId || null}
            placeholder="Select member"
            aria-label="Select member role tag target"
            onChange={(value) => onSelectedRoleUserIdChange(value ?? "")}
            data={activeTeamMembers.map((member) => ({
              value: member.user_id,
              label: member.user_id,
            }))}
          />
          {selectedRoleMember ? <Badge color="blue">{selectedRoleMember.role_tag ?? "No tag"}</Badge> : null}
        </Group>
        <Group gap={8} wrap="wrap">
          {roleTagPresets.map((tag) => (
            <Button
              key={tag}
              size="xs"
              onClick={() => onAssignRoleTag(tag)}
              disabled={!canAssignRoleTag}
              loading={roleTagPending}
            >
              {tag}
            </Button>
          ))}
          <Button
            size="xs"
            color="red"
            onClick={() => onAssignRoleTag(null)}
            disabled={!canAssignRoleTag}
            loading={roleTagPending}
          >
            Clear
          </Button>
        </Group>
      </Stack>
      </div>
    </InfiniCard>
  );
}


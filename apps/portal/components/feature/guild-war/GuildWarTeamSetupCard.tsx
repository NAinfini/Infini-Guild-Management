import { Button, Group, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";

type TeamMember = {
  user_id: string;
};

type TeamSetupTeam = {
  id: string;
  team_name: string;
  notes: string | null;
  is_locked: boolean;
  members: TeamMember[];
};

type GuildWarTeamSetupCardProps = {
  teams: TeamSetupTeam[];
  teamDraftNames: Record<string, string>;
  teamDraftNotes: Record<string, string>;
  teamDraftLocks: Record<string, boolean>;
  savePending: boolean;
  saveDisabled: boolean;
  onTeamLockChange: (teamId: string, checked: boolean) => void;
  onTeamNameChange: (teamId: string, value: string) => void;
  onTeamNotesChange: (teamId: string, value: string) => void;
  onMoveTeamOrder: (teamId: string, direction: "up" | "down") => void;
  onCopyTeamLabel: (teamId: string, draftName: string) => Promise<void> | void;
  onSaveTeams: () => void;
};

export function GuildWarTeamSetupCard({
  teams,
  teamDraftNames,
  teamDraftNotes,
  teamDraftLocks,
  savePending,
  saveDisabled,
  onTeamLockChange,
  onTeamNameChange,
  onTeamNotesChange,
  onMoveTeamOrder,
  onCopyTeamLabel,
  onSaveTeams,
}: GuildWarTeamSetupCardProps) {
  return (
    <InfiniCard>
      <div style={{ padding: "1.2rem" }}>
      <Stack gap={10}>
        <Text fw={600}>Team Setup</Text>
        {teams.map((team, teamIndex) => {
          const draftName = teamDraftNames[team.id] ?? team.team_name;
          const draftNotes = teamDraftNotes[team.id] ?? team.notes ?? "";
          const draftLocked = teamDraftLocks[team.id] ?? team.is_locked;
          return (
            <InfiniCard key={team.id} className="war-team-card">
              <div style={{ padding: "1.2rem" }}>
              <Stack gap={8}>
                <Text fw={500}>Team {teamIndex + 1}</Text>
                <Group gap={8} wrap="wrap">
                  <Text c="dimmed" size="sm">
                    Team lock
                  </Text>
                  <Switch
                    checked={draftLocked}
                    onLabel="Locked"
                    offLabel="Open"
                    onChange={(event) => onTeamLockChange(team.id, event.currentTarget.checked)}
                  />
                </Group>
                <TextInput
                  value={draftName}
                  onChange={(event) => onTeamNameChange(team.id, event.currentTarget.value)}
                  disabled={draftLocked}
                  aria-label={`Team name for ${team.team_name}`}
                  placeholder="Team name"
                />
                <Textarea
                  value={draftNotes}
                  onChange={(event) => onTeamNotesChange(team.id, event.currentTarget.value)}
                  disabled={draftLocked}
                  aria-label={`Team notes for ${team.team_name}`}
                  placeholder="Team notes"
                  minRows={2}
                />
                <Group gap={8} wrap="wrap">
                  <Text c="dimmed" size="sm">
                    {team.members.length} members
                  </Text>
                  <Button
                    size="xs"
                    onClick={() => onMoveTeamOrder(team.id, "up")}
                    disabled={teamIndex === 0 || draftLocked}
                    aria-label={`Move ${team.team_name} up`}
                  >
                    Move up
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => onMoveTeamOrder(team.id, "down")}
                    disabled={teamIndex === teams.length - 1 || draftLocked}
                    aria-label={`Move ${team.team_name} down`}
                  >
                    Move down
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => {
                      void onCopyTeamLabel(team.id, draftName);
                    }}
                  >
                    Copy label
                  </Button>
                </Group>
              </Stack>
              </div>
            </InfiniCard>
          );
        })}
        <MotionButton type="primary" onClick={onSaveTeams} loading={savePending} disabled={saveDisabled}>
          Save Teams to History
        </MotionButton>
      </Stack>
      </div>
    </InfiniCard>
  );
}
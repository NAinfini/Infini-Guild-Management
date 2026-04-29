import { ActionIcon, Badge, Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { PortalCard } from "../../shared/PortalCard";
import { IconChevronLeft, IconChevronRight, IconDeviceFloppy } from "@tabler/icons-react";

type GuildWarActiveTopCardProps = {
  selectedEventId: string | undefined;
  eventOptions: Array<{ value: string; label: string }>;
  eventPlaceholder: string;
  onSelectedEventIdChange: (value: string) => void;
  canManage: boolean;
  activeSearch: string;
  onActiveSearchChange: (value: string) => void;
  searchPlaceholder: string;
  matchLabel?: string;
  onPrevMatch?: () => void;
  onNextMatch?: () => void;
  hasMatches?: boolean;
  isTeamsDirty?: boolean;
  saveTeamsPending?: boolean;
  onSaveTeams?: () => void;
  saveTeamsLabel?: string;
  unsavedLabel?: string;
};

export function GuildWarActiveTopCard({
  selectedEventId,
  eventOptions,
  eventPlaceholder,
  onSelectedEventIdChange,
  canManage,
  activeSearch,
  onActiveSearchChange,
  searchPlaceholder,
  matchLabel,
  onPrevMatch,
  onNextMatch,
  hasMatches,
  isTeamsDirty,
  saveTeamsPending,
  onSaveTeams,
  saveTeamsLabel,
  unsavedLabel,
}: GuildWarActiveTopCardProps) {
  return (
    <PortalCard interactive={false} className="guild-war-active-top-card">
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          {/* Event selector + search + actions */}
          <Group gap={10} wrap="wrap" align="center">
            <TextInput
              style={{ flex: "1 1 200px", maxWidth: 320 }}
              value={activeSearch}
              onChange={(event) => onActiveSearchChange(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              aria-label="Search active guild war members"
            />
            {activeSearch && hasMatches ? (
              <Group gap={4} wrap="nowrap">
                <ActionIcon variant="subtle" size="sm" onClick={onPrevMatch} disabled={!onPrevMatch} aria-label="Previous match">
                  <IconChevronLeft size={14} />
                </ActionIcon>
                <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>{matchLabel}</Text>
                <ActionIcon variant="subtle" size="sm" onClick={onNextMatch} disabled={!onNextMatch} aria-label="Next match">
                  <IconChevronRight size={14} />
                </ActionIcon>
              </Group>
            ) : null}
            <Select
              style={{ flex: "0 1 320px", marginInlineStart: "auto" }}
              value={selectedEventId ?? null}
              placeholder={eventPlaceholder}
              aria-label="Select guild war event"
              onChange={(value) => onSelectedEventIdChange(value ?? "")}
              data={eventOptions}
            />
          </Group>

          {/* Save teams row (dirty indicator + save button) */}
          {canManage && onSaveTeams ? (
            <Group gap={8} wrap="wrap" align="center">
              {isTeamsDirty ? <Badge color="yellow">{unsavedLabel ?? "Unsaved"}</Badge> : null}
              <Button
                size="xs"
                variant="light"
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={onSaveTeams}
                loading={saveTeamsPending}
                disabled={!isTeamsDirty}
              >
                {saveTeamsLabel ?? "Save Teams"}
              </Button>
            </Group>
          ) : null}

        </Stack>
      </div>
    </PortalCard>
  );
}


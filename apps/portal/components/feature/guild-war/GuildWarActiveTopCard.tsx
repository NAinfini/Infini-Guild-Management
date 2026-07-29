import { ActionIcon, Badge, Button, Group, Paper, Select, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { ChevronLeftIcon, ChevronRightIcon, FlagIcon, PlusIcon, SaveIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";

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
  onConcludeWar?: () => void;
  concludeWarLabel?: string;
  concludeWarDisabled?: boolean;
  concludeWarDisabledReason?: string;
  onAddTeam?: () => void;
  onSaveTeams?: () => void | Promise<boolean>;
  saveTeamsPending?: boolean;
  teamsDirty?: boolean;
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
  onConcludeWar,
  concludeWarLabel,
  concludeWarDisabled,
  concludeWarDisabledReason,
  onAddTeam,
  onSaveTeams,
  saveTeamsPending,
  teamsDirty,
}: GuildWarActiveTopCardProps) {
  const { t } = useTranslation("guild-war");
  return (
    <Paper withBorder radius="md" p="var(--card-padding)" className="guild-war-active-top-card">
      <div>
        <Stack gap={12}>
          <Group gap={10} wrap="wrap" align="center">
            <TextInput
              style={{ flex: "1 1 200px", maxWidth: 320 }}
              value={activeSearch}
              onChange={(event) => onActiveSearchChange(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              aria-label={t("active.aria.searchMembers")}
            />
            {activeSearch && hasMatches ? (
              <Group gap={4} wrap="nowrap">
                <ActionIcon variant="subtle" size="sm" onClick={onPrevMatch} disabled={!onPrevMatch} aria-label={t("active.aria.prevMatch")}>
                  <ChevronLeftIcon size={14} />
                </ActionIcon>
                <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>{matchLabel}</Text>
                <ActionIcon variant="subtle" size="sm" onClick={onNextMatch} disabled={!onNextMatch} aria-label={t("active.aria.nextMatch")}>
                  <ChevronRightIcon size={14} />
                </ActionIcon>
              </Group>
            ) : null}
            <Select
              style={{ flex: "0 1 320px", marginInlineStart: "auto" }}
              value={selectedEventId ?? null}
              placeholder={eventPlaceholder}
              aria-label={t("active.aria.selectEvent")}
              onChange={(value) => onSelectedEventIdChange(value ?? "")}
              data={eventOptions}
              disabled={saveTeamsPending}
            />
            {canManage && onSaveTeams ? (
              <Group gap={6} wrap="nowrap">
                {teamsDirty ? (
                  <Badge color="orange" variant="light" size="sm">
                    {t("active.unsaved")}
                  </Badge>
                ) : null}
                <Tooltip label={t("active.noUnsavedChanges")} disabled={teamsDirty}>
                  <span data-disabled-tooltip-target style={{ display: "inline-flex" }}>
                    <Button
                      size="xs"
                      leftSection={<SaveIcon size={16} />}
                      onClick={onSaveTeams}
                      loading={saveTeamsPending}
                      disabled={!teamsDirty || saveTeamsPending}
                    >
                      {t("active.saveTeams")}
                    </Button>
                  </span>
                </Tooltip>
              </Group>
            ) : null}
            {canManage && onAddTeam ? (
              <Button
                variant="default"
                size="xs"
                leftSection={<PlusIcon size={16} />}
                onClick={onAddTeam}
              >
                {t("active.addTeam")}
              </Button>
            ) : null}
            {canManage && onConcludeWar ? (
              <Tooltip
                label={concludeWarDisabledReason}
                disabled={!concludeWarDisabled || !concludeWarDisabledReason}
                withArrow
              >
                <span>
                  <Button
                    color="red"
                    size="xs"
                    leftSection={<FlagIcon size={16} />}
                    onClick={onConcludeWar}
                    disabled={concludeWarDisabled}
                  >
                    {concludeWarLabel ?? t("active.concludeWar")}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </Group>
        </Stack>
      </div>
    </Paper>
  );
}

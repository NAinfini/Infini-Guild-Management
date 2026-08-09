import { ActionIcon, Button, Group, Paper, Select, Text, TextInput, Tooltip } from "@mantine/core";
import { ChevronLeftIcon, ChevronRightIcon, FlagIcon, PlusIcon } from "@portal/components/icons";
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
  saveTeamsPending?: boolean;
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
  saveTeamsPending,
}: GuildWarActiveTopCardProps) {
  const { t } = useTranslation("guild-war");
  return (
    <Paper withBorder radius="md" p="var(--card-padding)" className="guild-war-active-top-card">
      <div className="guild-war-active-top-card__filters">
        <div className="guild-war-active-top-card__event-slot">
          <Text component="label" size="xs" fw={600} c="dimmed">
            {t("active.event")}
          </Text>
          <Select
            className="guild-war-active-top-card__event"
            value={selectedEventId ?? null}
            placeholder={eventPlaceholder}
            aria-label={t("active.aria.selectEvent")}
            onChange={(value) => onSelectedEventIdChange(value ?? "")}
            data={eventOptions}
            disabled={saveTeamsPending}
          />
        </div>

        <div className="guild-war-active-top-card__search-slot">
          <TextInput
            className="guild-war-active-top-card__search"
            value={activeSearch}
            onChange={(event) => onActiveSearchChange(event.currentTarget.value)}
            placeholder={searchPlaceholder}
            aria-label={t("active.aria.searchMembers")}
          />
          {activeSearch && hasMatches ? (
            <Group gap={4} wrap="nowrap" className="guild-war-active-top-card__matches">
              <ActionIcon variant="subtle" size="sm" onClick={onPrevMatch} disabled={!onPrevMatch} aria-label={t("active.aria.prevMatch")}>
                <ChevronLeftIcon size={14} />
              </ActionIcon>
              <Text size="sm" c="dimmed" className="guild-war-active-top-card__match-label">{matchLabel}</Text>
              <ActionIcon variant="subtle" size="sm" onClick={onNextMatch} disabled={!onNextMatch} aria-label={t("active.aria.nextMatch")}>
                <ChevronRightIcon size={14} />
              </ActionIcon>
            </Group>
          ) : null}
        </div>

        {canManage ? (
          <Group gap={8} wrap="nowrap" align="center" className="guild-war-active-top-card__actions">
            {onAddTeam ? (
              <Button
                size="sm"
                variant="default"
                leftSection={<PlusIcon size={16} />}
                onClick={onAddTeam}
              >
                {t("active.addTeam")}
              </Button>
            ) : null}
            {onConcludeWar ? (
              <div className="guild-war-active-top-card__danger">
                <Tooltip
                  label={concludeWarDisabledReason}
                  disabled={!concludeWarDisabled || !concludeWarDisabledReason}
                  withArrow
                >
                  <span>
                    <Button
                      size="sm"
                      color="red"
                      variant="light"
                      leftSection={<FlagIcon size={16} />}
                      onClick={onConcludeWar}
                      disabled={concludeWarDisabled}
                    >
                      {concludeWarLabel ?? t("active.concludeWar")}
                    </Button>
                  </span>
                </Tooltip>
              </div>
            ) : null}
          </Group>
        ) : null}
      </div>
    </Paper>
  );
}

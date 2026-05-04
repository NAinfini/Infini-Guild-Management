import { ActionIcon, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { PortalCard } from "../../shared/PortalCard";
import { ChevronLeftIcon, ChevronRightIcon } from "@portal/components/icons";
import { IconFlag } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { DepthButton } from "../../shared/DepthButton";

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
}: GuildWarActiveTopCardProps) {
  const { t } = useTranslation("guild-war");
  return (
    <PortalCard interactive={false} className="guild-war-active-top-card">
      <div style={{ padding: "1.2rem" }}>
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
            />
            {canManage && onConcludeWar ? (
              <DepthButton
                type="danger"
                size="xs"
                before={<IconFlag size={16} />}
                onClick={onConcludeWar}
                disabled={concludeWarDisabled}
              >
                {concludeWarLabel ?? t("active.concludeWar")}
              </DepthButton>
            ) : null}
          </Group>
        </Stack>
      </div>
    </PortalCard>
  );
}

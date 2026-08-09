import type { GuildWarActiveResponse } from "@guild/shared";
import { TextInput } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";

type TeamStatusPanelProps = {
  team: GuildWarActiveResponse["teams"][number];
  draftNotes: string;
  draftLocked: boolean;
  onDraftNotesChange: (teamId: string, value: string) => void;
};

export const TeamStatusPanel = memo(function TeamStatusPanel({
  team,
  draftNotes,
  draftLocked,
  onDraftNotesChange,
}: TeamStatusPanelProps) {
  const { t } = useTranslation("guild-war");

  return (
    <TextInput
      className="guild-war-team-notes"
      value={draftNotes}
      onChange={(event) => onDraftNotesChange(team.id, event.currentTarget.value)}
      disabled={draftLocked}
      aria-label={t("active.aria.teamNotes", { teamName: team.team_name })}
      placeholder={t("active.teamSetup.notesPlaceholder")}
      size="xs"
    />
  );
});

import type { GuildWarActiveResponse } from "@guild/shared";
import { Button, Group, Select, Stack, Switch, TagsInput, Text, TextInput } from "@mantine/core";
import { IconCopy, IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { copyPlainText } from "../../../utils/copy";
import { notifications } from "@mantine/notifications";

const ROLE_TAG_PRESETS = ["tank", "dps", "heal", "lead", "support", "flex"] as const;

function splitRoleTags(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((p) => p.trim()).filter(Boolean);
}

function joinRoleTags(tags: readonly string[]): string | null {
  const result = tags.map((t) => t.trim()).filter(Boolean);
  return result.length > 0 ? result.join(", ") : null;
}

type TeamRoleEditorState = { userId: string; tags: string[] };

type RoleTagMutation = {
  isPending: boolean;
  mutate: (payload: { event_id: string; user_id: string; role_tag: string | null }) => void;
};

type TeamStatusPanelProps = {
  team: GuildWarActiveResponse["teams"][number];
  teamIndex: number;
  totalTeams: number;
  draftName: string;
  draftNotes: string;
  draftLocked: boolean;
  selectedEventId: string | undefined;
  roleTagMutation: RoleTagMutation;
  onDraftNameChange: (teamId: string, value: string) => void;
  onDraftNotesChange: (teamId: string, value: string) => void;
  onDraftLockChange: (teamId: string, locked: boolean) => void;
  onMoveTeamOrder: (teamId: string, direction: "up" | "down") => void;
};

export function TeamStatusPanel({
  team,
  teamIndex,
  totalTeams,
  draftName,
  draftNotes,
  draftLocked,
  selectedEventId,
  roleTagMutation,
  onDraftNameChange,
  onDraftNotesChange,
  onDraftLockChange,
  onMoveTeamOrder,
}: TeamStatusPanelProps) {
  const { t } = useTranslation("guild-war");

  const [roleEditor, setRoleEditor] = useState<TeamRoleEditorState | null>(null);

  useEffect(() => {
    if (team.members.length === 0) {
      setRoleEditor(null);
      return;
    }
    setRoleEditor((current) => {
      if (current && team.members.some((m) => m.user_id === current.userId)) return current;
      const first = team.members[0];
      if (!first) return null;
      return { userId: first.user_id, tags: splitRoleTags(first.role_tag) };
    });
  }, [team.members]);

  const selectedMember = team.members.find((m) => m.user_id === roleEditor?.userId) ?? null;
  const selectedMemberRoleTags = splitRoleTags(selectedMember?.role_tag ?? null);

  return (
    <Stack gap={8}>
      <Group gap={8} wrap="wrap" align="center">
        <Switch
          size="sm"
          checked={draftLocked}
          onLabel={t("active.teamSetup.locked")}
          offLabel={t("active.teamSetup.open")}
          onChange={(event) => onDraftLockChange(team.id, event.currentTarget.checked)}
        />
        <Button
          size="xs"
          variant="light"
          onClick={() => onMoveTeamOrder(team.id, "up")}
          disabled={draftLocked || teamIndex === 0}
        >
          {t("active.teamSetup.moveUp")}
        </Button>
        <Button
          size="xs"
          variant="light"
          onClick={() => onMoveTeamOrder(team.id, "down")}
          disabled={draftLocked || teamIndex === totalTeams - 1}
        >
          {t("active.teamSetup.moveDown")}
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconCopy size={16} />}
          onClick={() => {
            void copyPlainText(
              `${draftName.trim() || team.team_name}: ${team.members.map((m) => `@${m.user_id}`).join(", ")}`,
            );
            notifications.show({ color: "green", message: t("active.teamCopied") });
          }}
        >
          {t("active.teamSetup.copyLabel")}
        </Button>
      </Group>
      <Group gap={8} wrap="wrap" grow>
        <TextInput
          value={draftName}
          onChange={(event) => onDraftNameChange(team.id, event.currentTarget.value)}
          disabled={draftLocked}
          aria-label={`Team name for ${team.team_name}`}
          placeholder={t("active.teamSetup.namePlaceholder")}
          style={{ flex: "1 1 180px" }}
        />
        <TextInput
          value={draftNotes}
          onChange={(event) => onDraftNotesChange(team.id, event.currentTarget.value)}
          disabled={draftLocked}
          aria-label={`Team notes for ${team.team_name}`}
          placeholder={t("active.teamSetup.notesPlaceholder")}
          style={{ flex: "2 1 220px" }}
        />
      </Group>
      <Group gap={8} wrap="wrap" align="flex-end">
        <Select
          value={roleEditor?.userId ?? null}
          onChange={(value) => {
            const nextUserId = value ?? "";
            const nextMember = team.members.find((m) => m.user_id === nextUserId);
            setRoleEditor({ userId: nextUserId, tags: splitRoleTags(nextMember?.role_tag ?? null) });
          }}
          data={team.members.map((m) => ({ value: m.user_id, label: m.user_id }))}
          placeholder={t("active.teamSetup.roleTags.memberPlaceholder")}
          aria-label={t("active.teamSetup.roleTags.memberLabel")}
          disabled={draftLocked || team.members.length === 0}
          searchable
          style={{ flex: "1 1 200px", minWidth: 180 }}
        />
        <Button
          size="xs"
          variant="light"
          color="red"
          leftSection={<IconTrash size={16} />}
          disabled={draftLocked || !selectedEventId || !roleEditor?.userId}
          loading={roleTagMutation.isPending}
          onClick={() => {
            if (!selectedEventId || !roleEditor?.userId) return;
            setRoleEditor({ userId: roleEditor.userId, tags: [] });
            roleTagMutation.mutate({ event_id: selectedEventId, user_id: roleEditor.userId, role_tag: null });
          }}
        >
          {t("active.teamSetup.roleTags.clear")}
        </Button>
      </Group>
      <TagsInput
        value={roleEditor?.tags ?? []}
        onChange={(values) =>
          setRoleEditor((current) => (current ? { ...current, tags: values } : current))
        }
        data={Array.from(new Set([...ROLE_TAG_PRESETS, ...(roleEditor?.tags ?? [])]))}
        disabled={draftLocked || team.members.length === 0}
        placeholder={t("active.teamSetup.roleTags.tagsPlaceholder")}
        aria-label={t("active.teamSetup.roleTags.tagsLabel")}
        clearable
      />
      <Group gap={8} wrap="wrap" justify="space-between" align="center">
        <Text size="xs" c="dimmed">
          {t("active.teamSetup.roleTags.current", {
            tags: selectedMemberRoleTags.join(", ") || t("active.teamSetup.roleTags.noTag"),
          })}
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconDeviceFloppy size={16} />}
          disabled={draftLocked || !selectedEventId || !roleEditor?.userId}
          loading={roleTagMutation.isPending}
          onClick={() => {
            if (!selectedEventId || !roleEditor?.userId) return;
            roleTagMutation.mutate({
              event_id: selectedEventId,
              user_id: roleEditor.userId,
              role_tag: joinRoleTags(roleEditor.tags),
            });
          }}
        >
          {t("active.teamSetup.roleTags.apply")}
        </Button>
      </Group>
    </Stack>
  );
}

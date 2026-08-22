import { Button, Group, Modal, Stack, TextInput, Textarea } from "@mantine/core";
import { useTranslation } from "react-i18next";

export type GuildWarTeamEditTarget = {
  containerId: string;
  name: string;
  notes: string;
  locked: boolean;
};

type GuildWarTeamEditModalProps = {
  target: GuildWarTeamEditTarget | null;
  onNameChange: (containerId: string, value: string) => void;
  onNotesChange: (containerId: string, value: string) => void;
  onClose: () => void;
};

/*
 * 队名和备注在同一个弹窗里改。
 *
 * 只有关闭，没有取消：这块板子上的改动一律走草稿自动保存，摆一个「取消」等于承诺能撤回，
 * 而草稿模型撤不回来。
 */
export function GuildWarTeamEditModal({
  target,
  onNameChange,
  onNotesChange,
  onClose,
}: GuildWarTeamEditModalProps) {
  const { t } = useTranslation("guild-war");

  return (
    <Modal
      opened={Boolean(target)}
      onClose={onClose}
      title={t("active.teamSetup.edit")}
      centered
    >
      {target ? (
        <Stack gap="md">
          <TextInput
            label={t("active.teamSetup.namePlaceholder")}
            value={target.name}
            onChange={(event) => onNameChange(target.containerId, event.currentTarget.value)}
            data-autofocus
          />
          {/* 锁住的队伍连备注也不给改，跟锁住之后拖不动是同一条规矩。 */}
          <Textarea
            label={t("active.teamSetup.notesPlaceholder")}
            description={target.locked ? t("active.teamSetup.locked") : undefined}
            value={target.notes}
            onChange={(event) => onNotesChange(target.containerId, event.currentTarget.value)}
            disabled={target.locked}
            autosize
            minRows={3}
            maxRows={8}
          />
          <Group justify="flex-end">
            <Button onClick={onClose}>{t("common:action.close")}</Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
}

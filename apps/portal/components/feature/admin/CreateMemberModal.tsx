import { DepthButton } from "@infini-dev-kit/frontend/components";
import {
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconCheck, IconCopy, IconUserPlus } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type CreateMemberResult = {
  user_id: string;
  username: string;
  temporary_password: string;
};

type CreateMemberModalProps = {
  opened: boolean;
  onClose: () => void;
  onCreateMember: (data: {
    username: string;
    discordName: string;
    wechatName: string;
    notes: string;
  }) => Promise<CreateMemberResult>;
  creating: boolean;
};

export function CreateMemberModal({
  opened,
  onClose,
  onCreateMember,
  creating,
}: CreateMemberModalProps) {
  const { t } = useTranslation("admin");
  const [username, setUsername] = useState("");
  const [discordName, setDiscordName] = useState("");
  const [wechatName, setWechatName] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<CreateMemberResult | null>(null);

  const resetForm = () => {
    setUsername("");
    setDiscordName("");
    setWechatName("");
    setNotes("");
    setResult(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreate = async () => {
    const trimmed = username.trim();
    if (!trimmed) return;

    const res = await onCreateMember({
      username: trimmed,
      discordName: discordName.trim(),
      wechatName: wechatName.trim(),
      notes: notes.trim(),
    });
    setResult(res);
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("member.create.modalTitle")}
      centered
      size="sm"
    >
      {result ? (
        <Stack gap={16}>
          <Text>{t("member.create.successMessage", { username: result.username })}</Text>
          <div>
            <Text size="sm" fw={600} mb={4}>{t("member.create.temporaryPassword")}</Text>
            <Group gap={8} wrap="nowrap">
              <TextInput
                value={result.temporary_password}
                readOnly
                style={{ flex: 1 }}
                styles={{ input: { fontFamily: "monospace" } }}
              />
              <CopyButton value={result.temporary_password}>
                {({ copied, copy }) => (
                  <DepthButton
                    onClick={copy}
                    type={copied ? "success" : "secondary"}
                    size="sm"
                    before={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  >
                    {copied ? t("member.create.copied") : t("member.create.copy")}
                  </DepthButton>
                )}
              </CopyButton>
            </Group>
          </div>
          <Group justify="flex-end">
            <DepthButton onClick={handleClose} type="primary" size="sm">
              {t("member.create.done")}
            </DepthButton>
          </Group>
        </Stack>
      ) : (
        <Stack gap={12}>
          <TextInput
            label={t("member.create.usernameLabel")}
            placeholder={t("member.create.usernamePlaceholder")}
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            required
            data-autofocus
          />
          <TextInput
            label={t("member.create.discordLabel")}
            placeholder={t("member.create.discordPlaceholder")}
            value={discordName}
            onChange={(event) => setDiscordName(event.currentTarget.value)}
          />
          <TextInput
            label={t("member.create.wechatLabel")}
            placeholder={t("member.create.wechatPlaceholder")}
            value={wechatName}
            onChange={(event) => setWechatName(event.currentTarget.value)}
          />
          <Textarea
            label={t("member.create.notesLabel")}
            placeholder={t("member.create.notesPlaceholder")}
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            minRows={2}
            autosize
          />
          <Group justify="flex-end" mt={8}>
            <DepthButton onClick={handleClose} type="secondary" size="sm">
              {t("member.create.cancel")}
            </DepthButton>
            <DepthButton
              onClick={() => { void handleCreate(); }}
              type="success"
              size="sm"
              before={<IconUserPlus size={16} />}
              disabled={!username.trim() || creating}
            >
              {t("member.create.submit")}
            </DepthButton>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

import { DepthButton } from "@portal/components/shared/DepthButton";
import {
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { CheckIcon, CopyIcon, UserPlusIcon } from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";

const USERNAME_PATTERN = /^[a-zA-Z0-9_一-鿿]+$/;

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
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<CreateMemberResult | null>(null);

  const resetForm = () => {
    setUsername("");
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
    if (trimmed.length < 3 || trimmed.length > 50 || !USERNAME_PATTERN.test(trimmed)) {
      notifyError(t("member.create.usernameInvalid"));
      return;
    }

    try {
      const res = await onCreateMember({
        username: trimmed,
        notes: notes.trim(),
      });
      setResult(res);
    } catch {
      // Parent's onError handler already shows a notification
      return;
    }
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
                    before={copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
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
              before={<UserPlusIcon size={16} />}
              disabled={!username.trim() || creating}
              loading={creating}
            >
              {t("member.create.submit")}
            </DepthButton>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

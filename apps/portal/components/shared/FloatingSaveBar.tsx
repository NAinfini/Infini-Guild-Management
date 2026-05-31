import { Badge, Button, Group } from "@mantine/core";
import { SaveIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";

type FloatingSaveBarProps = {
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  label?: string;
};

export function FloatingSaveBar({ isDirty, saving, onSave, label }: FloatingSaveBarProps) {
  const { t } = useTranslation("profile");
  return (
    <div className="floating-save-bar" data-dirty={isDirty || undefined}>
      <Group justify="flex-end" gap={8}>
        <Badge color={isDirty ? "yellow" : "green"} variant="light">
          {isDirty ? t("status.unsavedChanges") : t("status.saved")}
        </Badge>
        <Button onClick={onSave} loading={saving} leftSection={<SaveIcon size={16} />}>
          {label ?? t("action.saveProfile")}
        </Button>
      </Group>
    </div>
  );
}

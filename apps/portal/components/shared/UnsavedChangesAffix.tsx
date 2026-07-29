import { Affix, Badge, Button, Group, Paper } from "@mantine/core";
import { SaveIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";

type UnsavedChangesAffixProps = {
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  label?: string;
};

export function UnsavedChangesAffix({
  isDirty,
  saving,
  onSave,
  label,
}: UnsavedChangesAffixProps) {
  const { t } = useTranslation("profile");
  return (
    <Affix
      className="unsaved-changes-affix"
      position={{
        right: "var(--unsaved-affix-inline)",
        bottom: "var(--unsaved-affix-bottom)",
      }}
    >
      <Paper
        withBorder
        shadow="md"
        p="sm"
        className="unsaved-changes-affix__surface"
        data-dirty={isDirty || undefined}
      >
        <Group justify="flex-end" gap="sm" wrap="nowrap">
          <Badge color={isDirty ? "yellow" : "green"} variant="light">
            {isDirty ? t("status.unsavedChanges") : t("status.saved")}
          </Badge>
          <Button
            onClick={onSave}
            loading={saving}
            disabled={!isDirty}
            leftSection={<SaveIcon size={16} />}
          >
            {label ?? t("action.saveProfile")}
          </Button>
        </Group>
      </Paper>
    </Affix>
  );
}

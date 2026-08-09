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
  if (!isDirty && !saving) {
    return null;
  }

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
        {/* 桌面按内容宽度，窄屏通栏；两端对齐让通栏时也不会全挤在右边。 */}
        <Group justify="space-between" gap="sm" wrap="nowrap">
          <Badge color={saving ? "blue" : "yellow"} variant="light">
            {saving ? t("status.saving") : t("status.unsavedChanges")}
          </Badge>
          <Button
            onClick={onSave}
            loading={saving}
            disabled={!isDirty || saving}
            leftSection={<SaveIcon size={16} />}
          >
            {label ?? t("action.saveProfile")}
          </Button>
        </Group>
      </Paper>
    </Affix>
  );
}

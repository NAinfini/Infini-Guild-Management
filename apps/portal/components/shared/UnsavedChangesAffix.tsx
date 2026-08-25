import { SaveIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
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
    <div
      className="unsaved-changes-affix"
    >
      <div className="unsaved-changes-affix__surface" data-dirty={isDirty || undefined}>
        {/* 桌面按内容宽度，窄屏通栏；两端对齐让通栏时也不会全挤在右边。 */}
        <div className="unsaved-changes-affix__content">
          <Badge
            variant="secondary"
            className={saving ? "unsaved-changes-affix__badge--saving" : "unsaved-changes-affix__badge--dirty"}
          >
            {saving ? t("status.saving") : t("status.unsavedChanges")}
          </Badge>
          <Button
            type="button"
            onClick={onSave}
            disabled={!isDirty || saving}
            aria-busy={saving || undefined}
          >
            <SaveIcon size={16} aria-hidden />
            {label ?? t("action.saveProfile")}
          </Button>
        </div>
      </div>
    </div>
  );
}

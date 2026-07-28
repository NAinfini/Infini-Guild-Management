import { useConfirmDialog } from "@portal/components/shared/ConfirmDialog";
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function useBeforeUnloadPrompt(enabled: boolean) {
  const { t } = useTranslation("common");
  const confirm = useConfirmDialog();

  useBlocker({
    disabled: !enabled,
    enableBeforeUnload: false,
    shouldBlockFn: async () => {
      if (!enabled) return false;
      const confirmed = await confirm({
        title: t("unsavedChanges.title"),
        description: t("unsavedChanges.message"),
        confirmLabel: t("unsavedChanges.leave"),
        cancelLabel: t("unsavedChanges.stay"),
        intent: "warning",
      });
      return !confirmed;
    },
  });
}

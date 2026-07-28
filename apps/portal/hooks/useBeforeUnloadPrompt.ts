import { useConfirmDialog } from "@portal/components/shared/ConfirmDialog";
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

type BeforeUnloadPromptOptions = {
  allowSamePathNavigation?: boolean;
};

export function useBeforeUnloadPrompt(
  enabled: boolean,
  options: BeforeUnloadPromptOptions = {},
) {
  const { t } = useTranslation("common");
  const confirm = useConfirmDialog();

  useBlocker({
    disabled: !enabled,
    enableBeforeUnload: enabled,
    shouldBlockFn: async ({ current, next }) => {
      if (!enabled) return false;
      if (options.allowSamePathNavigation && current.pathname === next.pathname) {
        return false;
      }
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

import { modals } from "@mantine/modals";
import { createElement } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function useBeforeUnloadPrompt(enabled: boolean) {
  const { t } = useTranslation("common");

  useBlocker({
    disabled: !enabled,
    enableBeforeUnload: enabled,
    shouldBlockFn: async () => {
      if (!enabled) return false;
      const confirmed = await new Promise<boolean>((resolve) => {
        modals.openConfirmModal({
          title: t("unsavedChanges.title"),
          children: createElement("p", null, t("unsavedChanges.message")),
          labels: { confirm: t("unsavedChanges.leave"), cancel: t("unsavedChanges.stay") },
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      return !confirmed;
    },
  });
}

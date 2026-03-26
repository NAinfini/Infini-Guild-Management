import { useBlocker } from "@tanstack/react-router";

export function useBeforeUnloadPrompt(enabled: boolean) {
  useBlocker({
    disabled: !enabled,
    enableBeforeUnload: enabled,
    shouldBlockFn: () => {
      if (!enabled) return false;
      return !window.confirm("You have unsaved changes. Are you sure you want to leave?");
    },
  });
}

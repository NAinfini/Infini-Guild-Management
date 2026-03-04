import { useRouterState } from "@tanstack/react-router";
import { isExternalViewSearch } from "../utils/external-view";

export function useExternalView(): boolean {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  return isExternalViewSearch(searchStr);
}

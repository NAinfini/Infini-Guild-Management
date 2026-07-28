import type { InviteLink } from "@guild/shared";
import { useCallback, useMemo, useState } from "react";
import type { InviteVisibility } from "../services/AdminService";
import { resolveInviteStatus } from "../utils/invite-status";
import { useDebouncedSearch } from "./useDebouncedSearch";

export function useAdminInviteController() {
  const [visibility, setInviteVisibility] = useState<InviteVisibility>("active");
  const {
    search,
    setSearch: setInviteSearch,
    debouncedSearch,
  } = useDebouncedSearch();

  const invite = useMemo(
    () => ({ visibility, search }),
    [search, visibility],
  );
  const isInviteInactive = useCallback(
    (row: InviteLink) => resolveInviteStatus(row) !== "active",
    [],
  );

  return {
    invite,
    debouncedInviteSearch: debouncedSearch.trim().toLowerCase(),
    isInviteInactive,
    setInviteVisibility,
    setInviteSearch,
  };
}

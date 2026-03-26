import { useMemo, useReducer } from "react";

export type InviteState = {
  visibility: "active" | "expired" | "revoked";
  maxUses: number;
  expiresAt: string;
  search: string;
};

type InviteAction =
  | { type: "SET_VISIBILITY"; value: InviteState["visibility"] }
  | { type: "SET_MAX_USES"; value: number }
  | { type: "SET_EXPIRES_AT"; value: string }
  | { type: "SET_SEARCH"; value: string };

type InviteLinkRow = {
  id: string;
  code: string;
  created_at: string;
  created_by: string;
  expires_at: string | null;
  revoked_at: string | null;
  used_count: number;
  max_uses: number;
};

const INVITE_INITIAL: InviteState = {
  visibility: "active",
  maxUses: 10,
  expiresAt: "",
  search: "",
};

function inviteReducer(state: InviteState, action: InviteAction): InviteState {
  switch (action.type) {
    case "SET_VISIBILITY":
      return { ...state, visibility: action.value };
    case "SET_MAX_USES":
      return { ...state, maxUses: action.value };
    case "SET_EXPIRES_AT":
      return { ...state, expiresAt: action.value };
    case "SET_SEARCH":
      return { ...state, search: action.value };
  }
}

type UseAdminInviteControllerParams = {
  inviteLinks: InviteLinkRow[];
};

export function useAdminInviteController({ inviteLinks }: UseAdminInviteControllerParams) {
  const [invite, dispatchInvite] = useReducer(inviteReducer, INVITE_INITIAL);

  const isInviteInactive = (row: InviteLinkRow) => {
    const expiredByDate = Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
    const fullyUsed = row.used_count >= row.max_uses;
    return Boolean(row.revoked_at) || expiredByDate || fullyUsed;
  };

  const inviteRows = useMemo(
    () =>
      inviteLinks.filter((row) => {
        if (invite.visibility === "revoked") {
          if (!row.revoked_at) {
            return false;
          }
        } else if (invite.visibility === "expired") {
          if (row.revoked_at) {
            return false;
          }
          const expiredByDate = Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
          const fullyUsed = row.used_count >= row.max_uses;
          if (!expiredByDate && !fullyUsed) {
            return false;
          }
        } else if (isInviteInactive(row)) {
          return false;
        }

        if (invite.search.trim()) {
          const query = invite.search.toLowerCase();
          const matches =
            row.code.toLowerCase().includes(query) ||
            row.created_at.toLowerCase().includes(query) ||
            (row.expires_at?.toLowerCase().includes(query) ?? false);
          if (!matches) {
            return false;
          }
        }

        return true;
      }),
    [invite, inviteLinks],
  );

  return {
    invite,
    inviteRows,
    isInviteInactive,
    setInviteVisibility: (value: InviteState["visibility"]) => dispatchInvite({ type: "SET_VISIBILITY", value }),
    setInviteMaxUses: (value: number) => dispatchInvite({ type: "SET_MAX_USES", value }),
    setInviteExpiresAt: (value: string) => dispatchInvite({ type: "SET_EXPIRES_AT", value }),
    setInviteSearch: (value: string) => dispatchInvite({ type: "SET_SEARCH", value }),
    resetInviteExpiresAt: () => dispatchInvite({ type: "SET_EXPIRES_AT", value: "" }),
  };
}

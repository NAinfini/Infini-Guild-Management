import type { MemberAvailability, MemberProfile, MemberSummary, UserBadge } from "@guild/shared";

export type AdminUserRow = {
  user: MemberSummary;
  profile: MemberProfile;
  badges: UserBadge[];
  edit_revisions?: AdminMemberEditRevisions;
};

export type AdminMemberEditRevisions = {
  user_revision_token: string;
  profile_revision_token: string;
};

export type MemberDetailFormState = {
  displayName: string;
  power: number;
  classes: string[];
  titleHtml: string;
  bio: string;
  availability: MemberAvailability | null;
  notes: string;
  role: string;
  isActive: boolean;
};
export type MemberStatusFilter = "all" | "active" | "inactive";

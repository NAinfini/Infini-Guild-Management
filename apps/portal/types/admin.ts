import type { MemberAvailability, MemberProfile, User, UserBadge } from "@guild/shared";

export type AdminUserRow = {
  user: User;
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

import type { MemberProfile, User, UserBadge } from "@guild/shared";

export type AdminUserRow = {
  user: User;
  profile: MemberProfile;
  badges: UserBadge[];
};

export type MemberDetailFormState = {
  power: number;
  classes: string[];
  titleHtml: string;
  bio: string;
  notes: string;
  role: string;
  isActive: boolean;
};

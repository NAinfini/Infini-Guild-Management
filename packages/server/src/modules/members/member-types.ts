import type {
  CatalogRevisionEntry,
  ClassTag,
  MemberAbsence,
  MemberAvailability,
  MemberBadge,
  MemberProfile,
  User,
  UserBadge,
} from "@guild/shared";
import type { ClassVectorIconId } from "@guild/shared/constants/class-icons";
import type { RequestContext } from "@guild/kernel";
import type { AuditEventWrite as AuditMutation } from "../audit/public.js";
import type { AudioUpload, ImageUpload } from "../media/public.js";

export type MemberProjection = "public" | "member" | "admin";

export type MemberUserRecord = Readonly<{
  id: string;
  display_name: string;
  roleId: string;
  roleName: string;
  roleColor: string | null;
  roleLevel: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revisionToken: string;
  /** 最近一次成功登录；从未登录或对外视图为 null。 */
  lastLoginAt: string | null;
}>;

export type MemberProfileRecord = Readonly<{
  userId: string;
  power: number;
  classes: readonly string[];
  titleHtml: string | null;
  bio: string | null;
  videoUrls: readonly string[];
  availability: MemberAvailability | null;
  vacationStart: string | null;
  vacationEnd: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  revisionToken: string;
}>;

export type MemberMediaRecord = Readonly<{
  avatarMediaId: string | null;
  images: readonly string[];
  audioMediaId: string | null;
  audioName: string | null;
}>;

export type MemberRecord = Readonly<{
  user: MemberUserRecord;
  profile: MemberProfileRecord;
  badges: readonly UserBadge[];
}>;

export type MemberWireRecord = Readonly<{
  user: User;
  profile: MemberProfile;
  badges: readonly UserBadge[];
  edit_revisions?: Readonly<{
    user_revision_token: string;
    profile_revision_token: string;
  }>;
}>;

export type MemberProfileUpdate = Readonly<{
  profile: MemberProfile;
  revisionToken: string;
}>;

export type MemberView = Readonly<{
  record: MemberRecord;
  media: MemberMediaRecord;
  projection: MemberProjection;
  includeEditRevisions?: boolean;
}>;

export type MemberTarget = Readonly<{
  userId: string;
  display_name: string;
  roleId: string;
  roleLevel: number;
  isActive: boolean;
  deletedAt: string | null;
  revisionToken: string;
  roleRevisionToken: string;
  profileRevisionToken: string;
}>;

export type RosterQuery = Readonly<{
  page: number;
  limit: number;
  search: string;
  roleId?: string;
  classId?: string;
  active?: boolean;
  includeTotal: boolean;
  projection: MemberProjection;
}>;

export type RosterPage = Readonly<{
  data: readonly MemberRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}>;

export type MemberProfilePatch = Readonly<{
  displayName?: string;
  power?: number;
  classes?: readonly string[];
  titleHtml?: string | null;
  bio?: string | null;
  videoUrls?: readonly string[];
  availability?: MemberAvailability | null;
  notes?: string | null;
  images?: readonly string[];
  updatedAt: string;
}>;

export type AbsencePolicy = Readonly<{ maxSpanDays: number; maxEntriesPerUser: number }>;

export type ClassCatalogStoreRecord = Readonly<{
  id: string;
  label: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  icon_type: "vector" | "image";
  vector_icon: ClassVectorIconId | null;
}>;

export type ClassTagStoreRecord = Omit<ClassTag, "usage_count">;

export type CatalogCreateResult<TRecord> =
  | Readonly<{ outcome: "created"; record: TRecord }>
  | Readonly<{ outcome: "conflict" | "limit_reached" }>;

export type ClassIconMutationSnapshot = Readonly<{
  iconType: "vector" | "image";
  vectorIcon: ClassVectorIconId | null;
  updatedAt: string;
  iconMediaId: string | null;
}>;

export type BadgeAssignmentMutationResult = Readonly<{
  changed: number;
  updatedAt: string | null;
}>;

export type BadgeAssignmentRecord = Readonly<{
  badgeId: string;
  userId: string;
  display_name: string;
  assignedBy: string;
  assignedByUsername: string | null;
  assignedAt: string;
}>;

export type BadgeAssignmentCursor = Readonly<{ display_name: string; userId: string }>;

export type ClassIconUpdate = Readonly<{
  expectedUpdatedAt: string;
  updatedAt: string;
}>;

export interface AbsencePolicyReader {
  readAbsencePolicy(): Promise<AbsencePolicy>;
}

export interface ClassTagUsageReader {
  countByTagIds(tagIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

export interface MemberMediaPort {
  listForMembers(userIds: readonly string[]): Promise<ReadonlyMap<string, MemberMediaRecord>>;
  uploadProfileImages(
    context: RequestContext,
    userId: string,
    uploads: readonly ImageUpload[],
    audit: AuditMutation,
    expectedProfileRevisionToken: string,
  ): Promise<readonly string[]>;
  deleteProfileImages(
    context: RequestContext,
    userId: string,
    mediaIds: readonly string[],
    audit: AuditMutation,
    expectedProfileRevisionToken: string,
  ): Promise<number>;
  uploadAvatar(
    context: RequestContext,
    userId: string,
    upload: ImageUpload,
    audit: AuditMutation,
    expectedProfileRevisionToken: string,
  ): Promise<string>;
  deleteAvatar(
    context: RequestContext,
    userId: string,
    audit: AuditMutation,
    expectedProfileRevisionToken: string,
  ): Promise<boolean>;
  uploadAudio(
    context: RequestContext,
    userId: string,
    upload: AudioUpload,
    audit: AuditMutation,
    expectedProfileRevisionToken: string,
  ): Promise<string>;
  deleteAudio(
    context: RequestContext,
    userId: string,
    audit: AuditMutation,
    expectedProfileRevisionToken: string,
  ): Promise<boolean>;
  uploadClassIcon(
    context: RequestContext,
    classId: string,
    upload: ImageUpload,
    update: ClassIconUpdate,
    audit: AuditMutation,
  ): Promise<ClassIconMutationSnapshot>;
  deleteClassIcon(
    context: RequestContext,
    classId: string,
    update: ClassIconUpdate,
    audit: AuditMutation,
  ): Promise<ClassIconMutationSnapshot>;
  listClassIcons(classIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface MembersStore {
  listRoster(query: RosterQuery): Promise<RosterPage>;
  getMember(userId: string, projection: MemberProjection): Promise<MemberRecord | null>;
  getMemberTarget(userId: string): Promise<MemberTarget | null>;
  getStats(): Promise<Readonly<{ activeMembers: number; totalMembers: number }>>;
  findMissingClassIds(classIds: readonly string[]): Promise<readonly string[]>;
  updateProfile(
    userId: string,
    patch: MemberProfilePatch,
    expectedTarget: MemberTarget,
    expectedImageIds: readonly string[],
    audit: AuditMutation,
  ): Promise<MemberProfileRecord | "display_name_taken" | null>;

  listAbsences(input: Readonly<{
    userId?: string;
    from?: string;
    to?: string;
    viewerUserId: string;
    projection: Exclude<MemberProjection, "public">;
  }>): Promise<readonly MemberAbsence[]>;
  countAbsences(userId: string): Promise<number>;
  createAbsence(input: Readonly<{
    id: string;
    userId: string;
    startDate: string;
    endDate: string;
    note: string | null;
    maximumEntries: number;
    now: string;
  }>, audit: AuditMutation): Promise<MemberAbsence | null>;
  deleteAbsence(userId: string, absenceId: string, audit: AuditMutation): Promise<boolean>;

  listClasses(): Promise<readonly ClassCatalogStoreRecord[]>;
  findClass(id: string): Promise<ClassCatalogStoreRecord | null>;
  createClass(input: Readonly<{
    id: string;
    label: string;
    color: string;
    vectorIcon: string;
    sortOrder?: number;
    now: string;
  }>, audit: AuditMutation): Promise<CatalogCreateResult<ClassCatalogStoreRecord>>;
  updateClass(id: string, input: Readonly<{
    label?: string;
    color?: string;
    vectorIcon?: string;
    sortOrder?: number;
    expectedUpdatedAt: string;
    now: string;
  }>, audit: AuditMutation): Promise<"updated" | "not_found" | "stale" | "conflict">;
  reorderClasses(input: Readonly<{
    order: readonly string[];
    expected: readonly CatalogRevisionEntry[];
    next: readonly CatalogRevisionEntry[];
  }>, audit: AuditMutation): Promise<"updated" | "stale_order">;
  deleteClass(id: string, expectedUpdatedAt: string, audit: AuditMutation): Promise<"deleted" | "not_found" | "stale" | "referenced">;

  listClassTags(): Promise<readonly ClassTagStoreRecord[]>;
  findClassTag(id: string): Promise<ClassTagStoreRecord | null>;
  createClassTag(input: Readonly<{
    id: string;
    label: string;
    classIds: readonly string[];
    sortOrder?: number;
    now: string;
  }>, audit: AuditMutation): Promise<CatalogCreateResult<ClassTagStoreRecord>>;
  updateClassTag(id: string, input: Readonly<{
    label?: string;
    classIds?: readonly string[];
    sortOrder?: number;
    expectedUpdatedAt: string;
    now: string;
  }>, audit: AuditMutation): Promise<"updated" | "not_found" | "stale" | "conflict">;
  reorderClassTags(input: Readonly<{
    order: readonly string[];
    expected: readonly CatalogRevisionEntry[];
    next: readonly CatalogRevisionEntry[];
  }>, audit: AuditMutation): Promise<"updated" | "stale_order">;
  deleteClassTag(
    id: string,
    expectedUpdatedAt: string,
    expectedUsageCount: number,
    audit: AuditMutation,
  ): Promise<"deleted" | "not_found" | "stale">;

  listBadges(): Promise<readonly MemberBadge[]>;
  findBadge(id: string): Promise<MemberBadge | null>;
  createBadge(input: Readonly<{
    id: string;
    name: string;
    labelHtml: string;
    color: string;
    description: string | null;
    sortOrder?: number;
    now: string;
  }>, audit: AuditMutation): Promise<CatalogCreateResult<MemberBadge>>;
  updateBadge(id: string, input: Readonly<{
    name?: string;
    labelHtml?: string;
    color?: string;
    description?: string | null;
    sortOrder?: number;
    expectedUpdatedAt: string;
    now: string;
  }>, audit: AuditMutation): Promise<"updated" | "not_found" | "stale" | "conflict">;
  reorderBadges(input: Readonly<{
    order: readonly string[];
    expected: readonly CatalogRevisionEntry[];
    next: readonly CatalogRevisionEntry[];
  }>, audit: AuditMutation): Promise<"updated" | "stale_order">;
  deleteBadge(id: string, expectedUpdatedAt: string, audit: AuditMutation): Promise<"deleted" | "not_found" | "stale">;
  listBadgeAssignments(
    badgeId: string,
    query: Readonly<{ limit: number; cursor: BadgeAssignmentCursor | null }>,
  ): Promise<Readonly<{ records: readonly BadgeAssignmentRecord[]; hasMore: boolean }>>;
  assignBadge(
    badgeId: string,
    userIds: readonly string[],
    actorUserId: string,
    updatedAt: string,
    audit: AuditMutation,
  ): Promise<BadgeAssignmentMutationResult>;
  unassignBadge(
    badgeId: string,
    userIds: readonly string[],
    updatedAt: string,
    audit: AuditMutation,
  ): Promise<BadgeAssignmentMutationResult>;
}

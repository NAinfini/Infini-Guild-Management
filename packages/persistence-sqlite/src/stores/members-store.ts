import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql as drizzleSql,
  type SQL,
} from "drizzle-orm";
import { availabilityFromWindows, availabilityToWindows } from "@guild/shared/schemas/user";
import { AppError } from "@guild/kernel";
import type { ClassVectorIconId } from "@guild/shared/constants/class-icons";
import { LIMITS } from "@guild/shared/config/limits";
import type { MemberAbsence, MemberBadge, UserBadge } from "@guild/shared";
import type {
  ClassCatalogStoreRecord,
  ClassTagStoreRecord,
  MemberProfilePatch,
  MemberProfileRecord,
  MemberRecord,
  MembersStore,
  MemberTarget,
  RosterPage,
  RosterQuery,
} from "@guild/server/modules/members";
import type { AuditMutation } from "@guild/server/modules/audit";
import type { AppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { roles, users } from "../schema/auth.js";
import {
  classCatalog,
  classTagMembers,
  classTags,
  memberAbsences,
  memberAvailabilityWindows,
  memberBadgeAssignments,
  memberBadges,
  memberProfileClasses,
  memberProfiles,
  memberProfileVideos,
} from "../schema/members.js";
import { auditInsertStatement } from "./audit-statement.js";
import { returnedRowCount } from "./sql-result.js";

type MembersSchema = {
  roles: typeof roles;
  users: typeof users;
  classCatalog: typeof classCatalog;
  classTagMembers: typeof classTagMembers;
  classTags: typeof classTags;
  memberAbsences: typeof memberAbsences;
  memberAvailabilityWindows: typeof memberAvailabilityWindows;
  memberBadgeAssignments: typeof memberBadgeAssignments;
  memberBadges: typeof memberBadges;
  memberProfileClasses: typeof memberProfileClasses;
  memberProfiles: typeof memberProfiles;
  memberProfileVideos: typeof memberProfileVideos;
};

type BaseMemberRow = Readonly<{
  userId: string;
  username: string;
  roleId: string;
  roleName: string;
  roleColor: string | null;
  roleLevel: number;
  isActive: boolean;
  deletedAt: string | null;
  userCreatedAt: string;
  userUpdatedAt: string;
  power: number;
  titleHtml: string | null;
  bio: string | null;
  availabilityTimezone: string | null;
  vacationStart: string | null;
  vacationEnd: string | null;
  notes: string | null;
  profileCreatedAt: string;
  profileUpdatedAt: string;
}>;

const publicMemberColumns = {
  userId: users.id,
  username: users.username,
  roleId: users.roleId,
  roleName: roles.name,
  roleColor: roles.color,
  roleLevel: roles.level,
  isActive: users.isActive,
  deletedAt: users.deletedAt,
  userCreatedAt: users.createdAt,
  userUpdatedAt: users.updatedAt,
  power: memberProfiles.power,
  titleHtml: memberProfiles.titleHtml,
  bio: memberProfiles.bio,
  availabilityTimezone: drizzleSql<string | null>`NULL`,
  vacationStart: drizzleSql<string | null>`NULL`,
  vacationEnd: drizzleSql<string | null>`NULL`,
  notes: drizzleSql<string | null>`NULL`,
  profileCreatedAt: memberProfiles.createdAt,
  profileUpdatedAt: memberProfiles.updatedAt,
} as const;

const memberColumns = {
  ...publicMemberColumns,
  availabilityTimezone: memberProfiles.availabilityTimezone,
  vacationStart: drizzleSql<string | null>`(
    SELECT ma.start_date FROM member_absences ma
    WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now')
    ORDER BY ma.start_date, ma.id LIMIT 1
  )`,
  vacationEnd: drizzleSql<string | null>`(
    SELECT ma.end_date FROM member_absences ma
    WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now')
    ORDER BY ma.start_date, ma.id LIMIT 1
  )`,
} as const;

const adminColumns = { ...memberColumns, notes: memberProfiles.notes } as const;

function run(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "run", sql, params };
}

function returning(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "all", columns: ["affected"], sql: `${sql} RETURNING 1 AS affected`, params };
}

function captureSystemTestSortOrder(
  targetType: "class_catalog" | "class_tag" | "badge",
  ids: readonly string[],
  now: string,
  audit: AuditMutation,
): SqlBatchStatement {
  const table = targetType === "class_catalog" ? "class_catalog" : targetType === "class_tag" ? "class_tags" : "member_badges";
  const catalogOnly = targetType === "class_tag" ? "AND target.owner_kind IS NULL" : "";
  const desired = JSON.stringify(ids.map((id, index) => ({ id, sort_order: index * 10 })));
  return run(
    `WITH desired AS (
       SELECT json_extract(value, '$.id') AS id,
              CAST(json_extract(value, '$.sort_order') AS INTEGER) AS sort_order
       FROM json_each(?)
     )
     INSERT INTO system_test_before_images (
       run_id, target_type, target_id, before_sort_order, before_updated_at,
       expected_sort_order, expected_updated_at, request_id, created_at
     )
     SELECT requests.run_id, ?, target.id, target.sort_order, target.updated_at,
            desired.sort_order, ?, ?, ?
     FROM system_test_requests AS requests
     JOIN desired
     JOIN ${table} AS target ON target.id = desired.id
     WHERE requests.request_id = ? ${catalogOnly}
       AND NOT EXISTS (
         SELECT 1 FROM system_test_artifacts AS artifacts
         WHERE artifacts.run_id = requests.run_id
           AND artifacts.artifact_type = ?
           AND artifacts.artifact_key = target.id
       )
     ON CONFLICT (run_id, target_type, target_id) DO UPDATE SET
       expected_sort_order = excluded.expected_sort_order,
       expected_updated_at = excluded.expected_updated_at,
       request_id = excluded.request_id`,
    [desired, targetType, now, audit.requestId, audit.occurredAt, audit.requestId, targetType],
  );
}

function reorderCatalog(
  targetType: "class_catalog" | "class_tag" | "badge",
  ids: readonly string[],
  now: string,
): SqlBatchStatement {
  const table = targetType === "class_catalog" ? "class_catalog" : targetType === "class_tag" ? "class_tags" : "member_badges";
  const catalogOnly = targetType === "class_tag" ? "AND owner_kind IS NULL" : "";
  const desired = JSON.stringify(ids.map((id, index) => ({ id, sortOrder: index * 10 })));
  return run(
    `UPDATE ${table}
     SET sort_order = (
       SELECT CAST(json_extract(value, '$.sortOrder') AS INTEGER)
       FROM json_each(?) desired
       WHERE CAST(json_extract(value, '$.id') AS TEXT) = ${table}.id
     ), updated_at = ?
     WHERE id IN (SELECT CAST(json_extract(value, '$.id') AS TEXT) FROM json_each(?)) ${catalogOnly}`,
    [desired, now, desired],
  );
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function foreignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

const SQL_IN_CHUNK = 100;

function chunks<T>(values: readonly T[], size = SQL_IN_CHUNK): readonly T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size));
}

function mediaSnapshot(mediaIds: readonly string[]): string {
  return mediaIds.join("\u001e");
}

function assertBoundedUnique(values: readonly string[], maximum: number, label: string, allowEmpty = false): void {
  if ((!allowEmpty && values.length === 0) || values.length > maximum || new Set(values).size !== values.length) {
    throw new RangeError(`${label} must contain ${allowEmpty ? "0" : "1"} to ${maximum} unique values`);
  }
}

export class SqliteMembersStore implements MembersStore {
  constructor(
    private readonly db: AppDatabase<MembersSchema>,
    private readonly executor: SqlExecutor,
  ) {}

  async listRoster(query: RosterQuery): Promise<RosterPage> {
    if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > LIMITS.pagination.users) {
      throw new RangeError(`Roster pages must contain 1 to ${LIMITS.pagination.users} members`);
    }
    const filters: SQL<unknown>[] = [isNull(users.deletedAt)];
    if (query.active !== undefined) filters.push(eq(users.isActive, query.active));
    if (query.search) filters.push(
      drizzleSql`lower(${users.username}) LIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'`,
    );
    if (query.roleId) filters.push(eq(users.roleId, query.roleId));
    if (query.classId) filters.push(drizzleSql`EXISTS (
      SELECT 1 FROM member_profile_classes mpc
      WHERE mpc.user_id = ${users.id} AND mpc.class_id = ${query.classId}
    )`);
    const where = and(...filters);
    const offset = (query.page - 1) * query.limit;
    const dataPromise = this.selectMemberRows(query.projection, where)
      .orderBy(asc(users.createdAt), asc(users.id)).limit(query.limit).offset(offset);
    const [baseRows, totalRows] = await Promise.all([
      dataPromise,
      query.includeTotal
        ? this.db.select({ value: count() }).from(users)
            .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id)).where(where)
        : Promise.resolve(null),
    ]);
    const data = await this.hydrate(baseRows as BaseMemberRow[], query.projection);
    const total = query.includeTotal ? Number(totalRows?.[0]?.value ?? 0) : offset + data.length;
    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: query.includeTotal
        ? Math.max(1, Math.ceil(total / query.limit))
        : data.length < query.limit ? query.page : query.page + 1,
    };
  }

  async getMember(userId: string, projection: "public" | "member" | "admin"): Promise<MemberRecord | null> {
    const rows = await this.selectMemberRows(projection, and(
      eq(users.id, userId),
      isNull(users.deletedAt),
      ...(projection === "admin" ? [] : [eq(users.isActive, true)]),
    )).limit(1);
    return (await this.hydrate(rows as BaseMemberRow[], projection))[0] ?? null;
  }

  async getMemberTarget(userId: string): Promise<MemberTarget | null> {
    const rows = await this.db.select({
      userId: users.id,
      username: users.username,
      roleId: users.roleId,
      roleLevel: roles.level,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      revisionToken: users.revisionToken,
      roleRevisionToken: roles.revisionToken,
      profileRevisionToken: memberProfiles.revisionToken,
    }).from(users).innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(memberProfiles, eq(users.id, memberProfiles.userId)).where(eq(users.id, userId)).limit(1);
    return rows[0] ?? null;
  }

  async getStats(): Promise<Readonly<{ activeMembers: number; totalMembers: number }>> {
    const rows = await this.db.select({
      activeMembers: drizzleSql<number>`coalesce(sum(case when ${users.deletedAt} is null and ${users.isActive} = 1 then 1 else 0 end), 0)`,
      totalMembers: drizzleSql<number>`coalesce(sum(case when ${users.deletedAt} is null then 1 else 0 end), 0)`,
    }).from(users).innerJoin(memberProfiles, eq(memberProfiles.userId, users.id));
    return {
      activeMembers: Number(rows[0]?.activeMembers ?? 0),
      totalMembers: Number(rows[0]?.totalMembers ?? 0),
    };
  }

  async findMissingClassIds(classIds: readonly string[]): Promise<readonly string[]> {
    if (classIds.length === 0) return [];
    assertBoundedUnique(classIds, LIMITS.content.classesPerTag.max, "Class ids", true);
    const rows = (await Promise.all(chunks(classIds).map((ids) => this.db.select({ id: classCatalog.id }).from(classCatalog)
      .where(inArray(classCatalog.id, ids))))).flat();
    const found = new Set(rows.map((row) => row.id));
    return classIds.filter((id) => !found.has(id));
  }

  async updateProfile(
    userId: string,
    patch: MemberProfilePatch,
    expectedTarget: MemberTarget,
    expectedImageIds: readonly string[],
    audit: AuditMutation,
  ): Promise<MemberProfileRecord | null> {
    assertBoundedUnique(expectedImageIds, LIMITS.content.profileImages.max, "Profile images", true);
    if (patch.images !== undefined) assertBoundedUnique(patch.images, LIMITS.content.profileImages.max, "Profile images", true);
    const assignments = ["updated_at = ?", "revision_token = ?"];
    const params: SqlValue[] = [patch.updatedAt, audit.id];
    if (patch.power !== undefined) { assignments.push("power = ?"); params.push(patch.power); }
    if (patch.titleHtml !== undefined) { assignments.push("title_html = ?"); params.push(patch.titleHtml); }
    if (patch.bio !== undefined) { assignments.push("bio = ?"); params.push(patch.bio); }
    if (patch.availability !== undefined) {
      assignments.push("availability_timezone = ?");
      params.push(patch.availability?.timezone ?? null);
    }
    if (patch.notes !== undefined) { assignments.push("notes = ?"); params.push(patch.notes); }
    params.push(
      userId,
      expectedTarget.profileRevisionToken,
      expectedTarget.userId,
      expectedTarget.roleId,
      expectedTarget.revisionToken,
      expectedTarget.roleRevisionToken,
      expectedTarget.roleLevel,
      expectedTarget.isActive ? 1 : 0,
      expectedTarget.deletedAt,
      mediaSnapshot(expectedImageIds),
    );
    const statements: SqlBatchStatement[] = [
      returning(`UPDATE member_profiles SET ${assignments.join(", ")}
        WHERE user_id = ? AND revision_token = ?
          AND EXISTS (
            SELECT 1 FROM users AS target
            JOIN roles AS target_role ON target_role.id = target.role_id
            WHERE target.id = ? AND target.role_id = ? AND target.revision_token = ?
              AND target_role.revision_token = ? AND target_role.level = ?
              AND target.is_active = ? AND target.deleted_at IS ?
          )
          AND COALESCE((
            SELECT group_concat(media_id, char(30)) FROM (
              SELECT media_id FROM media_links
              WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = 'image'
              ORDER BY sort_order, media_id
            )
          ), '') = ?`, [...params.slice(0, -1), userId, params.at(-1)!]),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ];
    if (patch.classes !== undefined) {
      assertBoundedUnique(patch.classes, LIMITS.content.classesPerProfile.max, "Profile classes", true);
      statements.push(run("DELETE FROM member_profile_classes WHERE user_id = ? AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)", [userId, userId, audit.id]));
      statements.push(run(
        `INSERT INTO member_profile_classes (user_id, class_id, sort_order)
         SELECT ?, CAST(value AS TEXT), CAST(key AS INTEGER) FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [userId, JSON.stringify(patch.classes), userId, audit.id],
      ));
    }
    if (patch.videoUrls !== undefined) {
      assertBoundedUnique(patch.videoUrls, LIMITS.content.profileVideoUrls.max, "Profile videos", true);
      statements.push(run("DELETE FROM member_profile_videos WHERE user_id = ? AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)", [userId, userId, audit.id]));
      statements.push(run(
        `INSERT INTO member_profile_videos (user_id, url, sort_order)
         SELECT ?, CAST(value AS TEXT), CAST(key AS INTEGER) FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [userId, JSON.stringify(patch.videoUrls), userId, audit.id],
      ));
    }
    if (patch.availability !== undefined) {
      statements.push(run("DELETE FROM member_availability_windows WHERE user_id = ? AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)", [userId, userId, audit.id]));
      const windows = patch.availability ? availabilityToWindows(patch.availability) : [];
      statements.push(run(
        `INSERT INTO member_availability_windows (user_id, weekday, start_minute, end_minute)
         SELECT ?, CAST(json_extract(value, '$.weekday') AS INTEGER),
           CAST(json_extract(value, '$.startMinute') AS INTEGER),
           CAST(json_extract(value, '$.endMinute') AS INTEGER)
         FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [userId, JSON.stringify(windows), userId, audit.id],
      ));
    }
    if (patch.images !== undefined) {
      statements.push(run(
        `UPDATE media_links SET sort_order = sort_order + 1000
         WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = 'image'
           AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [userId, userId, audit.id],
      ));
      const keep = patch.images.length === 0 ? "" : `AND media_id NOT IN (${placeholders(patch.images)})`;
      statements.push(run(
        `DELETE FROM media_links WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = 'image' ${keep}
           AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [userId, ...patch.images, userId, audit.id],
      ));
      statements.push(run(
        `UPDATE media_links
         SET sort_order = (
           SELECT CAST(desired.key AS INTEGER) FROM json_each(?) AS desired
           WHERE CAST(desired.value AS TEXT) = media_links.media_id
         )
         WHERE entity_type = 'member_profile' AND entity_id = ? AND slot = 'image'
           AND media_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [JSON.stringify(patch.images), userId, JSON.stringify(patch.images), userId, audit.id],
      ));
    }
    const results = await this.executor.batch(statements);
    if (returnedRowCount(results[0]) !== 1) return null;
    const member = await this.getMember(userId, "admin");
    return member?.profile ?? null;
  }

  async listAbsences(input: Parameters<MembersStore["listAbsences"]>[0]): Promise<readonly MemberAbsence[]> {
    const filters: SQL<unknown>[] = [isNull(users.deletedAt)];
    if (input.projection === "member") filters.push(eq(users.isActive, true));
    if (input.userId) filters.push(eq(memberAbsences.userId, input.userId));
    if (input.from) filters.push(gte(memberAbsences.endDate, input.from));
    if (input.to) filters.push(lte(memberAbsences.startDate, input.to));
    const note = input.projection === "admin"
      ? memberAbsences.note
      : drizzleSql<string | null>`CASE WHEN ${memberAbsences.userId} = ${input.viewerUserId} THEN ${memberAbsences.note} ELSE NULL END`;
    const rows = await this.db.select({
      id: memberAbsences.id,
      userId: memberAbsences.userId,
      username: users.username,
      roleId: users.roleId,
      roleName: roles.name,
      roleColor: roles.color,
      roleLevel: roles.level,
      startDate: memberAbsences.startDate,
      endDate: memberAbsences.endDate,
      note,
      createdAt: memberAbsences.createdAt,
    }).from(memberAbsences).innerJoin(users, eq(memberAbsences.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id)).where(and(...filters))
      .orderBy(desc(memberAbsences.startDate), asc(memberAbsences.id))
      .limit(LIMITS.content.absenceQueryResults.max + 1);
    if (rows.length > LIMITS.content.absenceQueryResults.max) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Absence query matches too many entries; narrow the requested window",
        details: { maximum_results: LIMITS.content.absenceQueryResults.max },
      });
    }
    return rows.map((row) => ({
      id: row.id,
      user_id: row.userId,
      username: row.username,
      role_id: row.roleId,
      role_name: row.roleName,
      role_color: row.roleColor,
      role_level: row.roleLevel,
      start_date: row.startDate,
      end_date: row.endDate,
      note: row.note,
      created_at: row.createdAt,
    }));
  }

  async countAbsences(userId: string): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(memberAbsences).where(eq(memberAbsences.userId, userId));
    return Number(rows[0]?.value ?? 0);
  }

  async createAbsence(input: Parameters<MembersStore["createAbsence"]>[0], audit: AuditMutation): Promise<MemberAbsence | null> {
    if (!Number.isInteger(input.maximumEntries) || input.maximumEntries < 1 || input.maximumEntries > LIMITS.content.absencesPerUser.max) {
      throw new RangeError(`Absence limit must be between 1 and ${LIMITS.content.absencesPerUser.max}`);
    }
    const results = await this.executor.batch([
      returning(
        `INSERT INTO member_absences (id, user_id, start_date, end_date, note, created_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE (SELECT count(*) FROM member_absences WHERE user_id = ?) < ?`,
        [input.id, input.userId, input.startDate, input.endDate, input.note, input.now, input.userId, input.maximumEntries],
      ),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ]);
    if (returnedRowCount(results[0]) !== 1) return null;
    const rows = await this.listAbsences({ userId: input.userId, viewerUserId: input.userId, projection: "member" });
    const created = rows.find((row) => row.id === input.id);
    return created ?? null;
  }

  async deleteAbsence(userId: string, absenceId: string, audit: AuditMutation): Promise<boolean> {
    const results = await this.executor.batch([
      returning("DELETE FROM member_absences WHERE id = ? AND user_id = ?", [absenceId, userId]),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ]);
    return returnedRowCount(results[0]) > 0;
  }

  async listClasses(): Promise<readonly ClassCatalogStoreRecord[]> {
    const rows = await this.db.select().from(classCatalog).orderBy(asc(classCatalog.sortOrder), asc(classCatalog.id));
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      color: row.color,
      icon_type: row.iconType,
      vector_icon: row.vectorIcon as ClassVectorIconId | null,
      sort_order: row.sortOrder,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
  }

  async findClass(id: string): Promise<ClassCatalogStoreRecord | null> {
    return (await this.listClasses()).find((row) => row.id === id) ?? null;
  }

  async createClass(input: Parameters<MembersStore["createClass"]>[0], audit: AuditMutation) {
    try {
      const results = await this.executor.batch([
        returning(
          `INSERT INTO class_catalog (id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at)
           SELECT ?, ?, ?, 'vector', ?, COALESCE(?, (SELECT COALESCE(max(sort_order), -10) + 10 FROM class_catalog)), ?, ?
           WHERE (SELECT count(*) FROM class_catalog) < ?`,
          [input.id, input.label, input.color, input.vectorIcon, input.sortOrder ?? null, input.now, input.now, LIMITS.content.classCatalogSize.max],
        ),
        auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      ]);
      return returnedRowCount(results[0]) === 1 ? "created" as const : "limit_reached" as const;
    } catch (error) {
      if (uniqueViolation(error)) return "conflict" as const;
      throw error;
    }
  }

  async updateClass(id: string, input: Parameters<MembersStore["updateClass"]>[1], audit: AuditMutation) {
    if (!(await this.findClass(id))) return "not_found" as const;
    const assignments = ["updated_at = ?"];
    const params: SqlValue[] = [input.now];
    if (input.label !== undefined) { assignments.push("label = ?"); params.push(input.label); }
    if (input.color !== undefined) { assignments.push("color = ?"); params.push(input.color); }
    if (input.vectorIcon !== undefined) { assignments.push("icon_type = 'vector'", "vector_icon = ?"); params.push(input.vectorIcon); }
    if (input.sortOrder !== undefined) { assignments.push("sort_order = ?"); params.push(input.sortOrder); }
    params.push(id);
    const statements: SqlBatchStatement[] = [
      returning(`UPDATE class_catalog SET ${assignments.join(", ")} WHERE id = ?`, params),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ];
    if (input.vectorIcon !== undefined) {
      statements.push(run(
        `DELETE FROM media_links
         WHERE entity_type = 'class_catalog' AND entity_id = ? AND slot = 'icon'
           AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
        [id, audit.id],
      ));
    }
    try {
      const results = await this.executor.batch(statements);
      return returnedRowCount(results[0]) === 1 ? "updated" as const : "not_found" as const;
    } catch (error) {
      if (uniqueViolation(error)) return "conflict" as const;
      throw error;
    }
  }

  async reorderClasses(ids: readonly string[], now: string, audit: AuditMutation) {
    assertBoundedUnique(ids, LIMITS.content.classCatalogSize.max, "Class order");
    const existing = (await this.listClasses()).map((row) => row.id).sort();
    if (ids.length !== existing.length || [...ids].sort().some((id, index) => id !== existing[index])) return "stale_order" as const;
    await this.executor.batch([
      captureSystemTestSortOrder("class_catalog", ids, now, audit),
      reorderCatalog("class_catalog", ids, now),
      auditInsertStatement(audit),
    ]);
    return "updated" as const;
  }

  async deleteClass(id: string, audit: AuditMutation) {
    if (!(await this.findClass(id))) return "not_found" as const;
    try {
      await this.executor.batch([
        run("DELETE FROM class_catalog WHERE id = ?", [id]),
        auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      ]);
      return "deleted" as const;
    } catch (error) {
      if (foreignKeyViolation(error)) return "referenced" as const;
      throw error;
    }
  }

  async listClassTags(): Promise<readonly ClassTagStoreRecord[]> {
    const tags = await this.db.select().from(classTags).where(isNull(classTags.ownerKind))
      .orderBy(asc(classTags.sortOrder), asc(classTags.id));
    if (tags.length === 0) return [];
    const members = await this.db.select({ tagId: classTagMembers.tagId, classId: classTagMembers.classId })
      .from(classTagMembers).where(inArray(classTagMembers.tagId, tags.map((tag) => tag.id)))
      .orderBy(asc(classTagMembers.tagId), asc(classTagMembers.classId));
    const byTag = new Map<string, string[]>();
    for (const row of members) byTag.set(row.tagId, [...(byTag.get(row.tagId) ?? []), row.classId]);
    return tags.map((tag) => ({
      id: tag.id,
      label: tag.label,
      class_ids: byTag.get(tag.id) ?? [],
      sort_order: tag.sortOrder,
      created_at: tag.createdAt,
      updated_at: tag.updatedAt,
    }));
  }

  async findClassTag(id: string): Promise<ClassTagStoreRecord | null> {
    return (await this.listClassTags()).find((tag) => tag.id === id) ?? null;
  }

  async createClassTag(input: Parameters<MembersStore["createClassTag"]>[0], audit: AuditMutation) {
    assertBoundedUnique(input.classIds, LIMITS.content.classesPerTag.max, "Class tag members", true);
    try {
      const results = await this.executor.batch([
        returning(
          `INSERT INTO class_tags (id, label, sort_order, owner_kind, owner_id, created_at, updated_at)
           SELECT ?, ?, COALESCE(?, (
             SELECT COALESCE(max(sort_order), -10) + 10 FROM class_tags WHERE owner_kind IS NULL
           )), NULL, NULL, ?, ?
           WHERE (SELECT count(*) FROM class_tags WHERE owner_kind IS NULL) < ?`,
          [input.id, input.label, input.sortOrder ?? null, input.now, input.now, LIMITS.content.classTags.max],
        ),
        auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
        run(
          `INSERT INTO class_tag_members (tag_id, class_id)
           SELECT ?, CAST(value AS TEXT) FROM json_each(?)
           WHERE EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
          [input.id, JSON.stringify(input.classIds), audit.id],
        ),
      ]);
      return returnedRowCount(results[0]) === 1 ? "created" as const : "limit_reached" as const;
    } catch (error) {
      if (uniqueViolation(error)) return "conflict" as const;
      throw error;
    }
  }

  async updateClassTag(id: string, input: Parameters<MembersStore["updateClassTag"]>[1], audit: AuditMutation) {
    if (input.classIds !== undefined) assertBoundedUnique(input.classIds, LIMITS.content.classesPerTag.max, "Class tag members", true);
    if (!(await this.findClassTag(id))) return "not_found" as const;
    const assignments = ["updated_at = ?"];
    const params: SqlValue[] = [input.now];
    if (input.label !== undefined) { assignments.push("label = ?"); params.push(input.label); }
    if (input.sortOrder !== undefined) { assignments.push("sort_order = ?"); params.push(input.sortOrder); }
    params.push(id);
    const statements: SqlBatchStatement[] = [run(`UPDATE class_tags SET ${assignments.join(", ")} WHERE id = ? AND owner_kind IS NULL`, params)];
    if (input.classIds !== undefined) {
      statements.push(run("DELETE FROM class_tag_members WHERE tag_id = ?", [id]));
      statements.push(run(
        `INSERT INTO class_tag_members (tag_id, class_id)
         SELECT ?, CAST(value AS TEXT) FROM json_each(?)`,
        [id, JSON.stringify(input.classIds)],
      ));
    }
    statements.push(auditInsertStatement(audit));
    try {
      await this.executor.batch(statements);
      return "updated" as const;
    } catch (error) {
      if (uniqueViolation(error)) return "conflict" as const;
      throw error;
    }
  }

  async reorderClassTags(ids: readonly string[], now: string, audit: AuditMutation) {
    assertBoundedUnique(ids, LIMITS.content.classTags.max, "Class tag order");
    const existing = (await this.listClassTags()).map((row) => row.id).sort();
    if (ids.length !== existing.length || [...ids].sort().some((id, index) => id !== existing[index])) return "stale_order" as const;
    await this.executor.batch([
      captureSystemTestSortOrder("class_tag", ids, now, audit),
      reorderCatalog("class_tag", ids, now),
      auditInsertStatement(audit),
    ]);
    return "updated" as const;
  }

  async deleteClassTag(id: string, audit: AuditMutation): Promise<boolean> {
    const results = await this.executor.batch([
      returning("DELETE FROM class_tags WHERE id = ? AND owner_kind IS NULL", [id]),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ]);
    return returnedRowCount(results[0]) > 0;
  }

  async listBadges(): Promise<readonly MemberBadge[]> {
    const rows = await this.db.select().from(memberBadges).orderBy(asc(memberBadges.sortOrder), asc(memberBadges.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      label_html: row.labelHtml,
      color: row.color,
      description: row.description,
      sort_order: row.sortOrder,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
  }

  async findBadge(id: string): Promise<MemberBadge | null> {
    return (await this.listBadges()).find((badge) => badge.id === id) ?? null;
  }

  async createBadge(input: Parameters<MembersStore["createBadge"]>[0], audit: AuditMutation) {
    try {
      const results = await this.executor.batch([
        returning(
          `INSERT INTO member_badges (id, name, label_html, color, description, sort_order, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, COALESCE(?, (SELECT COALESCE(max(sort_order), -10) + 10 FROM member_badges)), ?, ?
           WHERE (SELECT count(*) FROM member_badges) < ?`,
          [input.id, input.name, input.labelHtml, input.color, input.description, input.sortOrder ?? null, input.now, input.now, LIMITS.content.badgeCatalogSize.max],
        ),
        auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      ]);
      return returnedRowCount(results[0]) === 1 ? "created" as const : "limit_reached" as const;
    } catch (error) {
      if (uniqueViolation(error)) return "conflict" as const;
      throw error;
    }
  }

  async updateBadge(id: string, input: Parameters<MembersStore["updateBadge"]>[1], audit: AuditMutation) {
    if (!(await this.findBadge(id))) return "not_found" as const;
    const assignments = ["updated_at = ?"];
    const params: SqlValue[] = [input.now];
    if (input.name !== undefined) { assignments.push("name = ?"); params.push(input.name); }
    if (input.labelHtml !== undefined) { assignments.push("label_html = ?"); params.push(input.labelHtml); }
    if (input.color !== undefined) { assignments.push("color = ?"); params.push(input.color); }
    if (input.description !== undefined) { assignments.push("description = ?"); params.push(input.description); }
    if (input.sortOrder !== undefined) { assignments.push("sort_order = ?"); params.push(input.sortOrder); }
    params.push(id);
    try {
      await this.executor.batch([
        run(`UPDATE member_badges SET ${assignments.join(", ")} WHERE id = ?`, params),
        auditInsertStatement(audit),
      ]);
      return "updated" as const;
    } catch (error) {
      if (uniqueViolation(error)) return "conflict" as const;
      throw error;
    }
  }

  async reorderBadges(ids: readonly string[], now: string, audit: AuditMutation) {
    assertBoundedUnique(ids, LIMITS.content.badgeCatalogSize.max, "Badge order");
    const existing = (await this.listBadges()).map((row) => row.id).sort();
    if (ids.length !== existing.length || [...ids].sort().some((id, index) => id !== existing[index])) return "stale_order" as const;
    await this.executor.batch([
      captureSystemTestSortOrder("badge", ids, now, audit),
      reorderCatalog("badge", ids, now),
      auditInsertStatement(audit),
    ]);
    return "updated" as const;
  }

  async deleteBadge(id: string, audit: AuditMutation): Promise<boolean> {
    const results = await this.executor.batch([
      returning("DELETE FROM member_badges WHERE id = ?", [id]),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ]);
    return returnedRowCount(results[0]) > 0;
  }

  async listBadgeAssignments(badgeId: string, query: Parameters<MembersStore["listBadgeAssignments"]>[1]) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > LIMITS.pagination.badgeAssignments) {
      throw new RangeError(`Badge assignment pages must contain 1 to ${LIMITS.pagination.badgeAssignments} rows`);
    }
    const afterCursor = query.cursor ? or(
      gt(users.username, query.cursor.username),
      and(eq(users.username, query.cursor.username), gt(memberBadgeAssignments.userId, query.cursor.userId)),
    ) : undefined;
    const rows = await this.db.select({
      badgeId: memberBadgeAssignments.badgeId,
      userId: memberBadgeAssignments.userId,
      username: users.username,
      assignedBy: memberBadgeAssignments.assignedBy,
      assignedByUsername: drizzleSql<string | null>`(SELECT username FROM users assigner WHERE assigner.id = ${memberBadgeAssignments.assignedBy})`,
      assignedAt: memberBadgeAssignments.assignedAt,
    }).from(memberBadgeAssignments).leftJoin(users, eq(memberBadgeAssignments.userId, users.id))
      .where(and(eq(memberBadgeAssignments.badgeId, badgeId), afterCursor))
      .orderBy(asc(users.username), asc(memberBadgeAssignments.userId))
      .limit(query.limit + 1);
    const records = rows.slice(0, query.limit).map((row) => {
      if (row.username === null) {
        throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Badge assignment user is missing" });
      }
      return { ...row, username: row.username };
    });
    return { records, hasMore: rows.length > query.limit };
  }

  async assignBadge(badgeId: string, userIds: readonly string[], actorUserId: string, now: string, audit: AuditMutation): Promise<number> {
    assertBoundedUnique(userIds, 100, "Badge assignments");
    const results = await this.executor.batch([
      returning(
        `INSERT OR IGNORE INTO member_badge_assignments (badge_id, user_id, assigned_by, assigned_at)
         SELECT ?, CAST(value AS TEXT), ?, ? FROM json_each(?)`,
        [badgeId, actorUserId, now, JSON.stringify(userIds)],
      ),
      auditInsertStatement(audit),
    ]);
    return returnedRowCount(results[0]);
  }

  async unassignBadge(badgeId: string, userIds: readonly string[], audit: AuditMutation): Promise<number> {
    assertBoundedUnique(userIds, 100, "Badge assignments");
    const results = await this.executor.batch([
      returning(
        "DELETE FROM member_badge_assignments WHERE badge_id = ? AND user_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))",
        [badgeId, JSON.stringify(userIds)],
      ),
      auditInsertStatement(audit),
    ]);
    return returnedRowCount(results[0]);
  }

  private selectMemberRows(projection: "public" | "member" | "admin", where: SQL<unknown> | undefined) {
    const columns = projection === "public" ? publicMemberColumns : projection === "admin" ? adminColumns : memberColumns;
    return this.db.select(columns).from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id)).where(where);
  }

  private async hydrate(baseRows: readonly BaseMemberRow[], projection: "public" | "member" | "admin"): Promise<readonly MemberRecord[]> {
    const userIds = baseRows.map((row) => row.userId);
    if (userIds.length === 0) return [];
    const ids = JSON.stringify(userIds);
    const [classResult, videoResult, availabilityResult, badgeResult] = await Promise.all([
      this.executor.execute({
        method: "all",
        sql: `SELECT classes.user_id, classes.class_id
          FROM member_profile_classes AS classes
          JOIN json_each(?) AS requested ON CAST(requested.value AS TEXT) = classes.user_id
          ORDER BY classes.user_id, classes.sort_order`,
        params: [ids],
      }),
      this.executor.execute({
        method: "all",
        sql: `SELECT videos.user_id, videos.url
          FROM member_profile_videos AS videos
          JOIN json_each(?) AS requested ON CAST(requested.value AS TEXT) = videos.user_id
          ORDER BY videos.user_id, videos.sort_order`,
        params: [ids],
      }),
      projection === "public" ? Promise.resolve({ rows: [] } satisfies SqlResult) : this.executor.execute({
        method: "all",
        sql: `SELECT windows.user_id, windows.weekday, windows.start_minute, windows.end_minute
          FROM member_availability_windows AS windows
          JOIN json_each(?) AS requested ON CAST(requested.value AS TEXT) = windows.user_id
          ORDER BY windows.user_id, windows.weekday, windows.start_minute`,
        params: [ids],
      }),
      this.executor.execute({
        method: "all",
        sql: `SELECT assignments.user_id, badges.id, badges.name, badges.label_html, badges.color
          FROM member_badge_assignments AS assignments
          JOIN member_badges AS badges ON badges.id = assignments.badge_id
          JOIN json_each(?) AS requested ON CAST(requested.value AS TEXT) = assignments.user_id
          ORDER BY assignments.user_id, badges.sort_order, badges.id`,
        params: [ids],
      }),
    ]);
    const classes = new Map<string, string[]>();
    for (const [userId, classId] of sqlRows(classResult, 2, "member classes")) {
      if (typeof userId !== "string" || typeof classId !== "string") throw invalidHydration("member classes");
      classes.set(userId, [...(classes.get(userId) ?? []), classId]);
    }
    const videos = new Map<string, string[]>();
    for (const [userId, url] of sqlRows(videoResult, 2, "member videos")) {
      if (typeof userId !== "string" || typeof url !== "string") throw invalidHydration("member videos");
      videos.set(userId, [...(videos.get(userId) ?? []), url]);
    }
    const windows = new Map<string, Array<{ weekday: number; startMinute: number; endMinute: number }>>();
    for (const [userId, weekday, startMinute, endMinute] of sqlRows(availabilityResult, 4, "member availability")) {
      if (typeof userId !== "string" || typeof weekday !== "number"
        || typeof startMinute !== "number" || typeof endMinute !== "number") {
        throw invalidHydration("member availability");
      }
      windows.set(userId, [...(windows.get(userId) ?? []), { weekday, startMinute, endMinute }]);
    }
    const badges = new Map<string, UserBadge[]>();
    for (const [userId, id, name, labelHtml, color] of sqlRows(badgeResult, 5, "member badges")) {
      if (typeof userId !== "string" || typeof id !== "string" || typeof name !== "string"
        || typeof labelHtml !== "string" || typeof color !== "string") throw invalidHydration("member badges");
      badges.set(userId, [...(badges.get(userId) ?? []), { id, name, label_html: labelHtml, color }]);
    }
    return baseRows.map((row) => ({
      user: {
        id: row.userId,
        username: row.username,
        roleId: row.roleId,
        roleName: row.roleName,
        roleColor: row.roleColor,
        roleLevel: row.roleLevel,
        isActive: row.isActive,
        deletedAt: row.deletedAt,
        createdAt: row.userCreatedAt,
        updatedAt: row.userUpdatedAt,
      },
      profile: {
        userId: row.userId,
        power: row.power,
        classes: classes.get(row.userId) ?? [],
        titleHtml: row.titleHtml,
        bio: row.bio,
        videoUrls: videos.get(row.userId) ?? [],
        availability: row.availabilityTimezone
          ? availabilityFromWindows(row.availabilityTimezone, windows.get(row.userId) ?? [])
          : null,
        vacationStart: row.vacationStart,
        vacationEnd: row.vacationEnd,
        notes: row.notes,
        createdAt: row.profileCreatedAt,
        updatedAt: row.profileUpdatedAt,
      },
      badges: badges.get(row.userId) ?? [],
    }));
  }
}

function sqlRows(result: SqlResult, width: number, label: string): readonly (readonly SqlValue[])[] {
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row) || row.length !== width)) {
    throw invalidHydration(label);
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function invalidHydration(label: string): TypeError {
  return new TypeError(`SQLite returned invalid ${label} rows`);
}

export class SqliteClassTagUsageReader {
  constructor(private readonly executor: SqlExecutor) {}

  async countByTagIds(tagIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (tagIds.length === 0) return new Map();
    assertBoundedUnique(tagIds, LIMITS.content.classTags.max, "Class tag usage ids");
    const result = await this.executor.execute({
      method: "all",
      sql: `SELECT tag_id, count(*) FROM (
        SELECT tag_id FROM event_class_quotas WHERE tag_id IN (${placeholders(tagIds)})
        UNION ALL
        SELECT tag_id FROM recurring_template_class_quotas WHERE tag_id IN (${placeholders(tagIds)})
      ) usage GROUP BY tag_id`,
      params: [...tagIds, ...tagIds],
    });
    if (!Array.isArray(result.rows) || (result.rows.length > 0 && !Array.isArray(result.rows[0]))) return new Map();
    return new Map((result.rows as readonly (readonly SqlValue[])[]).map((row) => [String(row[0]), Number(row[1] ?? 0)]));
  }
}

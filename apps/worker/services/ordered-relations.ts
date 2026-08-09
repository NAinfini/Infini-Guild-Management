import {
  availabilityFromWindows,
  availabilityToWindows,
  type AvailabilityWindow,
  type MemberAvailability,
} from "@guild/shared";

type OrderedRelationSpec = {
  table: string;
  ownerColumn: string;
  valueColumn: string;
};

const OWNER_ID_CHUNK_SIZE = 50;

const MEMBER_CLASSES: OrderedRelationSpec = {
  table: "member_profile_classes",
  ownerColumn: "user_id",
  valueColumn: "class_id",
};

const MEMBER_VIDEOS: OrderedRelationSpec = {
  table: "member_profile_videos",
  ownerColumn: "user_id",
  valueColumn: "url",
};

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function loadOrderedRelations(
  db: D1Database,
  spec: OrderedRelationSpec,
  ownerIds: readonly string[],
): Promise<Map<string, string[]>> {
  const ids = uniqueValues(ownerIds);
  const result = new Map<string, string[]>();
  if (ids.length === 0) return result;
  for (let index = 0; index < ids.length; index += OWNER_ID_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + OWNER_ID_CHUNK_SIZE);
    const rows = await db.prepare(
      `SELECT ${spec.ownerColumn} AS owner_id, ${spec.valueColumn} AS value
       FROM ${spec.table}
       WHERE ${spec.ownerColumn} IN (${placeholders(chunk.length)})
       ORDER BY ${spec.ownerColumn}, sort_order, ${spec.valueColumn}`,
    ).bind(...chunk).all<{ owner_id: string; value: string }>();
    for (const row of rows.results ?? []) {
      const values = result.get(row.owner_id) ?? [];
      values.push(row.value);
      result.set(row.owner_id, values);
    }
  }
  return result;
}

function buildReplaceOrderedRelationStatements(
  db: D1Database,
  spec: OrderedRelationSpec,
  ownerId: string,
  values: readonly string[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM ${spec.table} WHERE ${spec.ownerColumn} = ?`).bind(ownerId),
  ];
  uniqueValues(values).forEach((value, sortOrder) => {
    statements.push(
      db.prepare(
        `INSERT INTO ${spec.table} (${spec.ownerColumn}, ${spec.valueColumn}, sort_order)
         VALUES (?, ?, ?)`,
      ).bind(ownerId, value, sortOrder),
    );
  });
  return statements;
}

export function loadMemberClasses(db: D1Database, userIds: readonly string[]) {
  return loadOrderedRelations(db, MEMBER_CLASSES, userIds);
}

export function loadMemberVideos(db: D1Database, userIds: readonly string[]) {
  return loadOrderedRelations(db, MEMBER_VIDEOS, userIds);
}

export function buildReplaceMemberClassStatements(db: D1Database, userId: string, classIds: readonly string[]) {
  return buildReplaceOrderedRelationStatements(db, MEMBER_CLASSES, userId, classIds);
}

export function buildReplaceMemberVideoStatements(db: D1Database, userId: string, urls: readonly string[]) {
  return buildReplaceOrderedRelationStatements(db, MEMBER_VIDEOS, userId, urls);
}

export async function loadMemberAvailabilityWindows(
  db: D1Database,
  userIds: readonly string[],
): Promise<Map<string, AvailabilityWindow[]>> {
  const ids = uniqueValues(userIds);
  const result = new Map<string, AvailabilityWindow[]>();
  for (let index = 0; index < ids.length; index += OWNER_ID_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + OWNER_ID_CHUNK_SIZE);
    const rows = await db.prepare(
      `SELECT user_id, weekday, start_minute, end_minute
       FROM member_availability_windows
       WHERE user_id IN (${placeholders(chunk.length)})
       ORDER BY user_id, weekday, start_minute, end_minute`,
    ).bind(...chunk).all<{
      user_id: string;
      weekday: number;
      start_minute: number;
      end_minute: number;
    }>();
    for (const row of rows.results ?? []) {
      const windows = result.get(row.user_id) ?? [];
      windows.push({
        weekday: row.weekday,
        startMinute: row.start_minute,
        endMinute: row.end_minute,
      });
      result.set(row.user_id, windows);
    }
  }
  return result;
}

export function availabilityFromStorage(
  timezone: string | null,
  windows: readonly AvailabilityWindow[],
): MemberAvailability | null {
  if (timezone === null) {
    if (windows.length > 0) {
      throw new Error("Member availability windows require an availability timezone");
    }
    return null;
  }
  return availabilityFromWindows(timezone, windows);
}

export function buildReplaceMemberAvailabilityStatements(
  db: D1Database,
  userId: string,
  availability: MemberAvailability | null,
): D1PreparedStatement[] {
  const statements = [
    db.prepare("DELETE FROM member_availability_windows WHERE user_id = ?").bind(userId),
  ];
  if (availability === null) return statements;
  for (const window of availabilityToWindows(availability)) {
    statements.push(
      db.prepare(
        `INSERT INTO member_availability_windows (user_id, weekday, start_minute, end_minute)
         VALUES (?, ?, ?, ?)`,
      ).bind(userId, window.weekday, window.startMinute, window.endMinute),
    );
  }
  return statements;
}

export function memberAvailabilityEquals(
  left: MemberAvailability | null,
  right: MemberAvailability | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (left.timezone !== right.timezone) return false;
  const leftWindows = availabilityToWindows(left);
  const rightWindows = availabilityToWindows(right);
  return leftWindows.length === rightWindows.length && leftWindows.every((window, index) => {
    const candidate = rightWindows[index];
    return candidate !== undefined &&
      window.weekday === candidate.weekday &&
      window.startMinute === candidate.startMinute &&
      window.endMinute === candidate.endMinute;
  });
}

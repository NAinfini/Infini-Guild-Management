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

const MEMBER_IMAGES: OrderedRelationSpec = {
  table: "member_profile_images",
  ownerColumn: "user_id",
  valueColumn: "media_key",
};

const EVENT_ATTACHMENTS: OrderedRelationSpec = {
  table: "event_attachments",
  ownerColumn: "event_id",
  valueColumn: "media_key",
};

const TEMPLATE_ATTACHMENTS: OrderedRelationSpec = {
  table: "recurring_template_attachments",
  ownerColumn: "template_id",
  valueColumn: "media_key",
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

export function loadMemberImages(db: D1Database, userIds: readonly string[]) {
  return loadOrderedRelations(db, MEMBER_IMAGES, userIds);
}

export function loadEventAttachments(db: D1Database, eventIds: readonly string[]) {
  return loadOrderedRelations(db, EVENT_ATTACHMENTS, eventIds);
}

export function loadRecurringTemplateAttachments(db: D1Database, templateIds: readonly string[]) {
  return loadOrderedRelations(db, TEMPLATE_ATTACHMENTS, templateIds);
}

export function buildReplaceMemberClassStatements(db: D1Database, userId: string, classIds: readonly string[]) {
  return buildReplaceOrderedRelationStatements(db, MEMBER_CLASSES, userId, classIds);
}

export function buildReplaceMemberImageStatements(db: D1Database, userId: string, mediaKeys: readonly string[]) {
  return buildReplaceOrderedRelationStatements(db, MEMBER_IMAGES, userId, mediaKeys);
}

export function buildReplaceEventAttachmentStatements(db: D1Database, eventId: string, mediaKeys: readonly string[]) {
  return buildReplaceOrderedRelationStatements(db, EVENT_ATTACHMENTS, eventId, mediaKeys);
}

export function buildReplaceRecurringTemplateAttachmentStatements(db: D1Database, templateId: string, mediaKeys: readonly string[]) {
  return buildReplaceOrderedRelationStatements(db, TEMPLATE_ATTACHMENTS, templateId, mediaKeys);
}

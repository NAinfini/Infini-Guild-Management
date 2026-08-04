import { DEFAULT_GAME_RULES, getEventBehavior, LIMITS, type GameRules } from "@guild/shared";
import type { RawDbLike } from "./EventCrudService";

/** 就地造的一次性组：只服务于这一个活动／模板，不进目录。 */
export type InlineClassTag = { label: string; class_ids: string[] };

/** 写进库里的一格：要么指着目录标签，要么带着一个待创建的一次性组。 */
export type ClassQuotaInput =
  | { tag_id: string; required: number }
  | { tag: InlineClassTag; required: number };

/** 读回来的一格：连带标签的名字和成员，展示层不用再单独查一次标签表。 */
export type ClassQuotaRow = {
  tag_id: string;
  required: number;
  label: string | null;
  class_ids: string[];
  /** 这一格用的是活动自己的一次性组，还是目录里的公用标签。 */
  one_time: boolean;
};

/*
 * 配额表有两张——活动一张、周期模板一张——形状完全一致，只有父表那一列名字不同。
 * 把差异收在这个描述符里，两边共用同一套读写逻辑，省得各写一遍再慢慢长歪。
 * 表名和列名都是本模块的常量，不来自请求，直接拼进 SQL 是安全的。
 * ownerKind 是一次性组写进 class_tags.owner_kind 的值，也就是「这个组属于谁」。
 */
export type ClassQuotaTable = {
  readonly table: string;
  readonly parentColumn: string;
  readonly ownerKind: string;
};

export const EVENT_CLASS_QUOTA_TABLE: ClassQuotaTable = {
  table: "event_class_quotas",
  parentColumn: "event_id",
  ownerKind: "event",
};

export const TEMPLATE_CLASS_QUOTA_TABLE: ClassQuotaTable = {
  table: "recurring_template_class_quotas",
  parentColumn: "template_id",
  ownerKind: "recurring_template",
};

type BoundStatement = ReturnType<ReturnType<RawDbLike["prepare"]>["bind"]>;

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(", ");
}

function readRows<T>(result: { results?: unknown[] } | unknown[] | undefined): T[] {
  const rows = Array.isArray(result) ? result : result?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * 找出不存在的职业标签 id。
 *
 * 两张配额表都对 class_tags 建了外键，但本仓库不假定 D1 真的在执行外键约束
 * （ClassCatalogService 至今仍手写级联删除），所以写入前显式查一次。查不到就报错，
 * 不静默丢弃——管理员传了个不存在的标签，配额少一格是他必须知道的事。
 *
 * 只认目录标签（owner_kind IS NULL）。别人的一次性组在这里一律算「不存在」：它们每次
 * 保存都会被整组重建，拿旧 id 引用一个下一秒就消失的行，写进去只会留下一格永远配不齐
 * 的悬空配额。宁可 400 说清楚。
 */
export async function findUnknownTagIds(
  rawDb: RawDbLike,
  quotas: readonly ClassQuotaInput[],
): Promise<string[]> {
  const wanted = [...new Set(catalogTagIds(quotas))];
  if (wanted.length === 0) {
    return [];
  }
  const result = await rawDb
    .prepare(
      `SELECT id FROM class_tags WHERE owner_kind IS NULL AND id IN (${placeholders(wanted.length)})`,
    )
    .bind(...wanted)
    .all?.();
  const known = new Set(readRows<{ id: string }>(result).map((row) => row.id));
  return wanted.filter((tagId) => !known.has(tagId));
}

/**
 * 找出一次性组里不存在的职业 id。目录标签的成员归 ClassTagService 把关，这里只看就地
 * 造的那些组——它们的成员从没经过任何一层校验。
 */
export async function findUnknownQuotaClassIds(
  rawDb: RawDbLike,
  quotas: readonly ClassQuotaInput[],
): Promise<string[]> {
  const wanted = [...new Set(inlineTags(quotas).flatMap((tag) => tag.class_ids))];
  if (wanted.length === 0) {
    return [];
  }
  const result = await rawDb
    .prepare(`SELECT id FROM class_catalog WHERE id IN (${placeholders(wanted.length)})`)
    .bind(...wanted)
    .all?.();
  const known = new Set(readRows<{ id: string }>(result).map((row) => row.id));
  return wanted.filter((classId) => !known.has(classId));
}

/**
 * 把两条「指向的东西存不存在」的检查合成一句话。活动和周期模板对配额的引用校验必须
 * 完全一致——模板生成出来的活动会原样继承配额，两边不一致时模板就能种下一批活动侧
 * 拒收的数据。返回错误文案而不是 ServiceErr，是为了不让这个模块反向依赖服务层。
 */
export async function findBrokenQuotaReferences(
  rawDb: RawDbLike,
  quotas: readonly ClassQuotaInput[],
): Promise<string | null> {
  const [unknownTags, unknownClasses] = await Promise.all([
    findUnknownTagIds(rawDb, quotas),
    findUnknownQuotaClassIds(rawDb, quotas),
  ]);
  if (unknownTags.length > 0) {
    return `Unknown class tag id: ${unknownTags.join(", ")}`;
  }
  if (unknownClasses.length > 0) {
    return `Unknown class id: ${unknownClasses.join(", ")}`;
  }
  return null;
}

function catalogTagIds(quotas: readonly ClassQuotaInput[]): string[] {
  return quotas.flatMap((quota) => ("tag_id" in quota ? [quota.tag_id] : []));
}

function inlineTags(quotas: readonly ClassQuotaInput[]): InlineClassTag[] {
  return quotas.flatMap((quota) => ("tag" in quota ? [quota.tag] : []));
}

/** 配额条数上限，和 zod 一致；服务层再挡一次，因为模板生成走的是复制而不是校验。 */
export const MAX_CLASS_QUOTAS = LIMITS.content.eventClassQuotas.max;

/**
 * 整组替换某一行的配额。先删后插，没有增量比对——配额行只有 (parent, tag) 和
 * required 三个字段，逐条 diff 换不来任何东西，反而多出几种中间状态。
 * 返回语句而不是直接执行，好让调用方塞进它自己那个 batch 里，跟父行的写入同生共死。
 *
 * 一次性组跟着一起整组重建：删除段先把这一行名下的所有私有标签清掉，然后每个 { tag }
 * 现造一个。它们没有值得保留的身份——没人能从别处引用它，改名和改成员都等价于换一个新
 * 的，逐条比对只会引来「这个组还是不是原来那个」这种没有答案的问题。
 * sort_order 按编辑器里的次序给，筹码行的排列因此跟表单一致。
 */
export function buildReplaceClassQuotaStatements(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentId: string,
  quotas: readonly ClassQuotaInput[],
  generateId: () => string,
): BoundStatement[] {
  const statements = buildDeleteClassQuotaStatements(rawDb, spec, parentId);
  quotas.slice(0, MAX_CLASS_QUOTAS).forEach((quota, index) => {
    let tagId: string;
    if ("tag_id" in quota) {
      tagId = quota.tag_id;
    } else {
      tagId = generateId();
      statements.push(
        rawDb
          .prepare(
            `INSERT INTO class_tags (id, label, sort_order, owner_kind, owner_id)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
          )
          .bind(tagId, quota.tag.label, index * 10, spec.ownerKind, parentId),
        ...quota.tag.class_ids.map((classId) =>
          rawDb
            .prepare("INSERT OR IGNORE INTO class_tag_members (tag_id, class_id) VALUES (?1, ?2)")
            .bind(tagId, classId),
        ),
      );
    }
    statements.push(
      rawDb
        .prepare(`INSERT INTO ${spec.table} (${spec.parentColumn}, tag_id, required) VALUES (?1, ?2, ?3)`)
        .bind(parentId, tagId, quota.required),
    );
  });
  return statements;
}

/**
 * 清空一行的配额，连同它名下的一次性组。
 *
 * class_tags 没有指回活动／模板的外键（owner_id 是个裸字符串，因为它要同时指两张表），
 * 所以删父行时没有任何东西会替我们把私有标签带走，这里必须显式删——本仓库本来也不假定
 * D1 在执行外键。漏了的话每改一次配额就多攒一批查不到、删不掉的孤儿标签。
 */
export function buildDeleteClassQuotaStatements(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentId: string,
): BoundStatement[] {
  return [
    rawDb.prepare(`DELETE FROM ${spec.table} WHERE ${spec.parentColumn} = ?1`).bind(parentId),
    rawDb
      .prepare(
        `DELETE FROM class_tag_members WHERE tag_id IN
         (SELECT id FROM class_tags WHERE owner_kind = ?1 AND owner_id = ?2)`,
      )
      .bind(spec.ownerKind, parentId),
    rawDb
      .prepare("DELETE FROM class_tags WHERE owner_kind = ?1 AND owner_id = ?2")
      .bind(spec.ownerKind, parentId),
  ];
}

/**
 * 把周期模板的配额复制到本轮新生成的活动上。
 *
 * 两种标签走两条路，不能混：
 *   - 目录标签是公用的，活动直接指过去就行，整段 INSERT ... SELECT 一句话搞定。
 *   - 模板私有的一次性组必须**逐个活动重造一份**，不能让活动共用模板那一个。共用的话，
 *     删掉模板会把它的私有标签一并带走（buildDeleteClassQuotaStatements），已经生成
 *     出来、甚至已经有人报名的活动会当场丢掉配额行——那是既成数据的损失。
 *
 * 复制只覆盖本轮真正插进去的活动，已存在的实例不回改：跟标题、人数上限一样，模板改动
 * 只影响之后生成的活动。
 */
export async function buildCloneTemplateQuotaStatements(
  rawDb: RawDbLike,
  templateId: string,
  eventIds: readonly string[],
  generateId: () => string,
): Promise<BoundStatement[]> {
  if (eventIds.length === 0) {
    return [];
  }
  const statements = eventIds.map((eventId) =>
    rawDb
      .prepare(
        `INSERT INTO ${EVENT_CLASS_QUOTA_TABLE.table} (${EVENT_CLASS_QUOTA_TABLE.parentColumn}, tag_id, required)
         SELECT ?1, q.tag_id, q.required FROM ${TEMPLATE_CLASS_QUOTA_TABLE.table} q
         WHERE q.${TEMPLATE_CLASS_QUOTA_TABLE.parentColumn} = ?2
           AND NOT EXISTS (SELECT 1 FROM class_tags t WHERE t.id = q.tag_id AND t.owner_kind IS NOT NULL)`,
      )
      .bind(eventId, templateId),
  );

  const result = await rawDb
    .prepare(
      `SELECT q.tag_id AS tag_id, q.required AS required, t.label AS label, t.sort_order AS sort_order
       FROM ${TEMPLATE_CLASS_QUOTA_TABLE.table} q
       JOIN class_tags t ON t.id = q.tag_id
       WHERE q.${TEMPLATE_CLASS_QUOTA_TABLE.parentColumn} = ?1 AND t.owner_kind = ?2
       ORDER BY t.sort_order, t.id`,
    )
    .bind(templateId, TEMPLATE_CLASS_QUOTA_TABLE.ownerKind)
    .all?.();
  const owned = readRows<{ tag_id: string; required: number; label: string; sort_order: number }>(result);
  if (owned.length === 0) {
    return statements;
  }

  const members = await loadTagMembers(rawDb, owned.map((row) => row.tag_id));
  for (const eventId of eventIds) {
    for (const row of owned) {
      statements.push(...cloneOwnedTag(rawDb, eventId, row, members.get(row.tag_id) ?? [], generateId()));
    }
  }
  return statements;
}

/** 把模板的一个私有组原样搬到一个活动名下：新标签、新成员行、新配额行。 */
function cloneOwnedTag(
  rawDb: RawDbLike,
  eventId: string,
  row: { required: number; label: string; sort_order: number },
  classIds: readonly string[],
  tagId: string,
): BoundStatement[] {
  return [
    rawDb
      .prepare(
        `INSERT INTO class_tags (id, label, sort_order, owner_kind, owner_id)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(tagId, row.label, row.sort_order, EVENT_CLASS_QUOTA_TABLE.ownerKind, eventId),
    ...classIds.map((classId) =>
      rawDb
        .prepare("INSERT OR IGNORE INTO class_tag_members (tag_id, class_id) VALUES (?1, ?2)")
        .bind(tagId, classId),
    ),
    rawDb
      .prepare(
        `INSERT INTO ${EVENT_CLASS_QUOTA_TABLE.table} (${EVENT_CLASS_QUOTA_TABLE.parentColumn}, tag_id, required)
         VALUES (?1, ?2, ?3)`,
      )
      .bind(eventId, tagId, row.required),
  ];
}

/**
 * 按父行 id 批量读回配额，顺序跟标签目录一致——筹码行的排列必须稳定，否则同一个
 * 活动在两次请求里筹码会换位置。
 *
 * 这里用 LEFT JOIN 而不是 INNER JOIN：标签被删时配额行应该跟着走（外键级联加
 * ClassTagService 里的显式删除），真出现了对不上标签表的配额行，那是 bug，要让它
 * 露出来而不是被 JOIN 悄悄滤掉——这类行 label 为 null、成员为空，排在最后。
 */
export async function loadClassQuotas(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentIds: readonly string[],
): Promise<Map<string, ClassQuotaRow[]>> {
  const map = new Map<string, ClassQuotaRow[]>();
  if (parentIds.length === 0) {
    return map;
  }
  const result = await rawDb
    .prepare(
      `SELECT q.${spec.parentColumn} AS parent_id, q.tag_id AS tag_id, q.required AS required,
              t.label AS label, t.owner_kind AS owner_kind
       FROM ${spec.table} q
       LEFT JOIN class_tags t ON t.id = q.tag_id
       WHERE q.${spec.parentColumn} IN (${placeholders(parentIds.length)})
       ORDER BY t.sort_order IS NULL, t.sort_order, q.tag_id`,
    )
    .bind(...parentIds)
    .all?.();

  const rows = readRows<{
    parent_id: string;
    tag_id: string;
    required: number;
    label: string | null;
    owner_kind: string | null;
  }>(result);
  const members = await loadTagMembers(rawDb, [...new Set(rows.map((row) => row.tag_id))]);
  for (const row of rows) {
    const list = map.get(row.parent_id) ?? [];
    list.push({
      tag_id: row.tag_id,
      label: row.label ?? null,
      class_ids: members.get(row.tag_id) ?? [],
      required: Number(row.required),
      /* 有主的标签就是一次性组。悬空配额（标签已被删干净）owner_kind 读回来是 null，
         归到公用标签那一边——编辑器会把它当成一个选不中的目录标签露出来，正好。 */
      one_time: row.owner_kind !== null && row.owner_kind !== undefined,
    });
    map.set(row.parent_id, list);
  }
  return map;
}

/**
 * 标签成员单独查一次，而不是跟上面那条 JOIN 在一起：一格配额对应多个职业，JOIN 上去
 * 会把配额行按成员数量乘出来，还得在内存里再折叠回去。成员顺序跟职业目录一致。
 */
async function loadTagMembers(
  rawDb: RawDbLike,
  tagIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (tagIds.length === 0) {
    return map;
  }
  const result = await rawDb
    .prepare(
      `SELECT m.tag_id AS tag_id, m.class_id AS class_id
       FROM class_tag_members m
       JOIN class_catalog c ON c.id = m.class_id
       WHERE m.tag_id IN (${placeholders(tagIds.length)})
       ORDER BY c.sort_order, m.class_id`,
    )
    .bind(...tagIds)
    .all?.();

  for (const row of readRows<{ tag_id: string; class_id: string }>(result)) {
    const list = map.get(row.tag_id) ?? [];
    list.push(row.class_id);
    map.set(row.tag_id, list);
  }
  return map;
}

export async function loadClassQuotasFor(
  rawDb: RawDbLike,
  spec: ClassQuotaTable,
  parentId: string,
): Promise<ClassQuotaRow[]> {
  return (await loadClassQuotas(rawDb, spec, [parentId])).get(parentId) ?? [];
}

/**
 * 投票的「参与者」是投票人，抽奖的是抽签池，两者都不是一支队伍——这两种类型不带配额。
 * 校验层已经拒收带配额的投票／抽奖请求，但类型是可以改的：活动改成投票时没人会再
 * 传 class_quotas，旧配额行必须在这里清掉，否则改回来就会冒出一批没人设过的配额。
 */
export function typeSupportsClassQuotas(type: string, rules: GameRules = DEFAULT_GAME_RULES): boolean {
  const behavior = getEventBehavior(rules, type);
  if (!behavior) throw new Error(`Unknown configured event type: ${type}`);
  return behavior !== "poll" && behavior !== "raffle";
}

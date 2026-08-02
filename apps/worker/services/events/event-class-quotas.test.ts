import { describe, expect, it } from "vitest";
import {
  buildCloneTemplateQuotaStatements,
  buildReplaceClassQuotaStatements,
  EVENT_CLASS_QUOTA_TABLE,
} from "./event-class-quotas";

type Prepared = { sql: string; bindings: unknown[] };

/**
 * 只回答「这条 SQL 该拿到什么」的假库。按语句关键字分发，因为这些 helper 里读的两次
 * 查询形状完全不同，用一个固定返回值糊过去等于没测到。
 */
function fakeDb(rows: (sql: string) => unknown[]) {
  const prepared: Prepared[] = [];
  return {
    prepared,
    db: {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => {
          const statement = { sql, bindings };
          prepared.push(statement);
          return { ...statement, all: async () => ({ results: rows(sql) }) };
        },
      }),
    } as never,
  };
}

describe("buildReplaceClassQuotaStatements", () => {
  it("materialises a one-time group as a tag owned by the event", () => {
    const { db, prepared } = fakeDb(() => []);

    const statements = buildReplaceClassQuotaStatements(
      db,
      EVENT_CLASS_QUOTA_TABLE,
      "evt-1",
      [{ tag: { label: "能拉怪的", class_ids: ["droid", "guard"] }, required: 2 }],
      () => "tag-new",
    );

    // 3 条删除打头，然后是标签、两个成员、配额行。
    expect(statements).toHaveLength(7);
    const inserts = prepared.filter((statement) => statement.sql.startsWith("INSERT"));
    expect(inserts[0]?.sql).toContain("INSERT INTO class_tags");
    // owner_kind/owner_id 指回这个活动，删活动时才带得走它。
    expect(inserts[0]?.bindings).toEqual(["tag-new", "能拉怪的", 0, "event", "evt-1"]);
    expect(inserts[1]?.bindings).toEqual(["tag-new", "droid"]);
    expect(inserts[2]?.bindings).toEqual(["tag-new", "guard"]);
    expect(inserts[3]?.bindings).toEqual(["evt-1", "tag-new", 2]);
  });
});

describe("buildCloneTemplateQuotaStatements", () => {
  it("clones a template-owned group once per generated event", async () => {
    let nextId = 0;
    const { db } = fakeDb((sql) => (
      sql.includes("class_tag_members")
        ? [{ tag_id: "tpl-tag", class_id: "droid" }]
        : [{ tag_id: "tpl-tag", required: 2, label: "能拉怪的", sort_order: 10 }]
    ));

    const statements = await buildCloneTemplateQuotaStatements(
      db,
      "tpl-1",
      ["evt-a", "evt-b"],
      () => `tag-${++nextId}`,
    ) as unknown as Prepared[];

    // 2 条目录标签的整段复制，加上两个活动各自的 标签 + 成员 + 配额行。
    expect(statements).toHaveLength(8);
    const owned = statements.slice(2);
    expect(owned[0]?.bindings).toEqual(["tag-1", "能拉怪的", 10, "event", "evt-a"]);
    expect(owned[2]?.bindings).toEqual(["evt-a", "tag-1", 2]);
    /* 第二个活动必须拿到一个**不同的**标签 id。共用的话删掉其中一个活动就会把另一个
       活动的配额行一起带走。 */
    expect(owned[3]?.bindings).toEqual(["tag-2", "能拉怪的", 10, "event", "evt-b"]);
    expect(owned[5]?.bindings).toEqual(["evt-b", "tag-2", 2]);
  });

  it("does nothing when no events were generated", async () => {
    const { db, prepared } = fakeDb(() => []);

    expect(await buildCloneTemplateQuotaStatements(db, "tpl-1", [], () => "tag-1")).toEqual([]);
    // 一条查询都不该发出去：这一轮没生成活动，连模板有没有配额都不用问。
    expect(prepared).toHaveLength(0);
  });
});

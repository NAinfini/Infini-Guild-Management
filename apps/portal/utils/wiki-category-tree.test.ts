import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { WikiCategoryDraft } from "@portal/types/wiki";
import {
  CATEGORY_INDENT_WIDTH,
  applyCategoryMove,
  flattenCategoryDrafts,
  getIndentMove,
  getOutdentMove,
  orderCategoryDrafts,
  projectCategoryMove,
} from "./wiki-category-tree";

const INDENT = 28;

function draft(id: string, parentId = "", sortOrder = 0): WikiCategoryDraft {
  return { id, name: id.toUpperCase(), slug: id, parent_id: parentId, sort_order: sortOrder };
}

/** [id, depth, parentId] 三元组，断言里比这个比逐字段展开好读。 */
function shape(drafts: WikiCategoryDraft[]): Array<[string, number, string]> {
  return flattenCategoryDrafts(drafts).map((entry) => [entry.draft.id, entry.depth, entry.parentId]);
}

describe("flattenCategoryDrafts", () => {
  it("按深度优先摊开：一个顶层紧跟自己的子级", () => {
    const drafts = [draft("a"), draft("b"), draft("a1", "a"), draft("b1", "b")];
    expect(shape(drafts)).toEqual([
      ["a", 0, ""],
      ["a1", 1, "a"],
      ["b", 0, ""],
      ["b1", 1, "b"],
    ]);
  });

  it("同一层内保持草稿数组里的先后", () => {
    const drafts = [draft("a"), draft("a2", "a"), draft("a1", "a")];
    expect(shape(drafts).map(([id]) => id)).toEqual(["a", "a2", "a1"]);
  });

  it("数出每个顶层挂了几个子级", () => {
    const flat = flattenCategoryDrafts([draft("a"), draft("a1", "a"), draft("a2", "a"), draft("b")]);
    expect(flat.map((entry) => entry.childCount)).toEqual([2, 0, 0, 0]);
  });

  it("第三层的行不会被丢掉，而是显示在顶层等人来改", () => {
    const drafts = [draft("a"), draft("a1", "a"), draft("a1x", "a1")];
    expect(shape(drafts)).toEqual([
      ["a", 0, ""],
      ["a1", 1, "a"],
      ["a1x", 0, ""],
    ]);
  });

  it("互相当爹的一对不会转圈，两个都落回顶层", () => {
    expect(shape([draft("a", "b"), draft("b", "a")])).toEqual([
      ["a", 0, ""],
      ["b", 0, ""],
    ]);
  });

  it("父级不存在、或自己当自己的爹，都按顶层处理", () => {
    expect(shape([draft("a", "ghost"), draft("b", "b")])).toEqual([
      ["a", 0, ""],
      ["b", 0, ""],
    ]);
  });
});

describe("orderCategoryDrafts", () => {
  it("把父子交错的序号理成树的顺序，但一个 sort_order 都不动", () => {
    const drafts = [draft("a1", "a", 0), draft("a", "", 1), draft("b", "", 2)];
    const ordered = orderCategoryDrafts(drafts);
    expect(ordered.map((item) => item.id)).toEqual(["a", "a1", "b"]);
    expect(ordered.map((item) => item.sort_order)).toEqual([1, 0, 2]);
  });
});

describe("projectCategoryMove", () => {
  const roots = [draft("a"), draft("b"), draft("c")];

  it("竖着拖不动横的：落在别人前面，还是顶层", () => {
    const items = flattenCategoryDrafts(roots);
    expect(projectCategoryMove({ items, activeId: "c", overId: "b", offsetX: 0, indentWidth: INDENT }))
      .toEqual({ parentId: "", index: 1 });
  });

  it("往右拖一格就挂到上一行底下", () => {
    const items = flattenCategoryDrafts(roots);
    expect(projectCategoryMove({ items, activeId: "b", overId: "b", offsetX: INDENT, indentWidth: INDENT }))
      .toEqual({ parentId: "a", index: 0 });
  });

  it("拖过头也只到第二层，第三层没有", () => {
    const items = flattenCategoryDrafts(roots);
    expect(projectCategoryMove({ items, activeId: "b", overId: "b", offsetX: INDENT * 5, indentWidth: INDENT }))
      .toEqual({ parentId: "a", index: 0 });
  });

  it("自己底下还挂着人，横着拖也挂不进去", () => {
    const drafts = [draft("a"), draft("a1", "a"), draft("b")];
    /* 拖动期间被拖那行的子级不在列表里，跟着它一起走。 */
    const items = flattenCategoryDrafts(drafts).filter((entry) => entry.parentId !== "a");
    expect(projectCategoryMove({ items, activeId: "a", overId: "b", offsetX: INDENT * 3, indentWidth: INDENT }))
      .toEqual({ parentId: "", index: 1 });
  });

  it("不许浅过下一行，否则下一行会平白变成自己的子级", () => {
    const drafts = [draft("a"), draft("a1", "a"), draft("b")];
    const items = flattenCategoryDrafts(drafts);
    expect(projectCategoryMove({ items, activeId: "b", overId: "a1", offsetX: 0, indentWidth: INDENT }))
      .toEqual({ parentId: "a", index: 0 });
  });

  it("落点不在列表里就不给落点", () => {
    const items = flattenCategoryDrafts(roots);
    expect(projectCategoryMove({ items, activeId: "a", overId: "ghost", offsetX: 0, indentWidth: INDENT }))
      .toBeNull();
  });
});

describe("applyCategoryMove", () => {
  it("挂过去之后 parent_id 落到新爹身上，序号按新的树顺序重排", () => {
    const drafts = [draft("a", "", 0), draft("b", "", 1), draft("c", "", 2)];
    const next = applyCategoryMove(drafts, "c", { parentId: "a", index: 0 });
    expect(next.map((item) => [item.id, item.parent_id, item.sort_order])).toEqual([
      ["a", "", 0],
      ["c", "a", 1],
      ["b", "", 2],
    ]);
  });

  it("顶层挪位置时子级跟着一起走", () => {
    const drafts = [draft("a", "", 0), draft("a1", "a", 1), draft("b", "", 2)];
    const next = applyCategoryMove(drafts, "a", { parentId: "", index: 1 });
    expect(next.map((item) => [item.id, item.parent_id, item.sort_order])).toEqual([
      ["b", "", 0],
      ["a", "", 1],
      ["a1", "a", 2],
    ]);
  });

  it("提回顶层：parent_id 清空", () => {
    const drafts = [draft("a", "", 0), draft("a1", "a", 1)];
    const next = applyCategoryMove(drafts, "a1", { parentId: "", index: 0 });
    expect(next.map((item) => [item.id, item.parent_id, item.sort_order])).toEqual([
      ["a1", "", 0],
      ["a", "", 1],
    ]);
  });

  it("index 超出这一层的长度就贴到末尾", () => {
    const drafts = [draft("a", "", 0), draft("b", "", 1)];
    const next = applyCategoryMove(drafts, "a", { parentId: "", index: 99 });
    expect(next.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("挂到一个子级底下会造出三层，原样退回", () => {
    const drafts = [draft("a", "", 0), draft("a1", "a", 1), draft("b", "", 2)];
    expect(applyCategoryMove(drafts, "b", { parentId: "a1", index: 0 })).toBe(drafts);
  });

  it("自己底下还挂着人时挂不出去，原样退回", () => {
    const drafts = [draft("a", "", 0), draft("a1", "a", 1), draft("b", "", 2)];
    expect(applyCategoryMove(drafts, "a", { parentId: "b", index: 0 })).toBe(drafts);
  });

  it("自己挂自己，原样退回", () => {
    const drafts = [draft("a", "", 0)];
    expect(applyCategoryMove(drafts, "a", { parentId: "a", index: 0 })).toBe(drafts);
  });

  it("认不出的行，原样退回", () => {
    const drafts = [draft("a", "", 0)];
    expect(applyCategoryMove(drafts, "ghost", { parentId: "", index: 0 })).toBe(drafts);
  });

  it("落回原位不算改动：稀疏的 sort_order 不会被顺手重排，保存按钮也不会平白点亮", () => {
    const drafts = [draft("a", "", 0), draft("a1", "a", 5), draft("b", "", 9)];
    expect(applyCategoryMove(drafts, "a1", { parentId: "a", index: 0 })).toBe(drafts);
  });
});

describe("缩进宽度的单一来源", () => {
  it("CATEGORY_INDENT_WIDTH 和 WikiPage.css 里的 --wiki-category-indent 对得上", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/WikiPage.css"), "utf8");
    expect(css).toContain(`--wiki-category-indent: ${CATEGORY_INDENT_WIDTH}px;`);
  });
});

describe("getIndentMove / getOutdentMove", () => {
  it("缩进：挂到上一个顶层的子级末尾", () => {
    const drafts = [draft("a"), draft("a1", "a"), draft("b")];
    expect(getIndentMove(drafts, "b")).toEqual({ parentId: "a", index: 1 });
  });

  it("第一行没有上一行可挂", () => {
    expect(getIndentMove([draft("a"), draft("b")], "a")).toBeNull();
  });

  it("已经是子级的不再缩进", () => {
    expect(getIndentMove([draft("a"), draft("a1", "a")], "a1")).toBeNull();
  });

  it("自己底下挂着人的不缩进", () => {
    const drafts = [draft("a"), draft("b"), draft("b1", "b")];
    expect(getIndentMove(drafts, "b")).toBeNull();
  });

  it("取消缩进：排在原来那个爹的紧后面", () => {
    const drafts = [draft("a"), draft("a1", "a"), draft("b")];
    expect(getOutdentMove(drafts, "a1")).toEqual({ parentId: "", index: 1 });
  });

  it("已经在顶层的没得取消", () => {
    expect(getOutdentMove([draft("a")], "a")).toBeNull();
  });
});

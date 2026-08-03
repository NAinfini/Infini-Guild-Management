import type { WikiCategoryDraft } from "@portal/types/wiki";

/*
 * 分类目录只有两层：顶层和它的子级。服务端也是这么判的——批量保存时会按整批落库
 * 之后的层级重算，凑出第三层的批次直接 400。所以这一层的每个判断都以「只有顶层
 * 能当爹」为准，界面上根本给不出会被服务端拒的落点。
 *
 * 草稿数组本身就是这棵树按深度优先展开的样子，sort_order 等于下标。保存时服务端
 * 拿到的是一串全局序号，重新读回来再按序号排，还是同一棵树、同一个兄弟顺序。
 */

/** 深度上限：0 是顶层，1 是子级。 */
export const CATEGORY_TREE_MAX_DEPTH = 1;

/**
 * 一层缩进多少像素。横向拖多远算深一层要按它换算，所以这个数必须和
 * WikiPage.css 里 `--wiki-category-indent` 的值一致——对不上的话，
 * 手感上「拖到下一格」的位置就和眼睛看到的缩进错开。单测钉住了这个等式。
 */
export const CATEGORY_INDENT_WIDTH = 28;

export type FlatCategory = {
  draft: WikiCategoryDraft;
  depth: number;
  /** 空串表示顶层。 */
  parentId: string;
  childCount: number;
};

/** 一次移动：挂到谁底下（空串＝顶层）、排在这一层的第几个。 */
export type CategoryMove = {
  parentId: string;
  index: number;
};

/*
 * 只有顶层分类能当爹。爹本身还挂在别人底下、爹不存在、爹是自己，这三种都当没爹处理。
 * 这不是把坏数据藏起来：解析成顶层之后那一行照样显示在列表里，谁挂错了一眼看得见，
 * 也能直接拖回去。同时这条规则顺手拆掉了 a→b→a 这类环——环上没有顶层节点，
 * 于是全部落回顶层，递归深度天然封在 1。
 */
function resolveParentId(draft: WikiCategoryDraft, byId: Map<string, WikiCategoryDraft>): string {
  const parentId = draft.parent_id?.trim() ?? "";
  if (!parentId || parentId === draft.id) {
    return "";
  }
  const parent = byId.get(parentId);
  if (!parent) {
    return "";
  }
  const grandParentId = parent.parent_id?.trim() ?? "";
  if (grandParentId && grandParentId !== parent.id && byId.has(grandParentId)) {
    return "";
  }
  return parentId;
}

/**
 * 把草稿摊成界面上从上到下的那一列：顶层、它的子级、下一个顶层……
 * 同一层内部保持草稿数组里的先后，不再另排一次序——排序规则实现两遍就会错两遍。
 */
export function flattenCategoryDrafts(drafts: WikiCategoryDraft[]): FlatCategory[] {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const childrenOf = new Map<string, WikiCategoryDraft[]>();
  for (const draft of drafts) {
    const parentId = resolveParentId(draft, byId);
    const bucket = childrenOf.get(parentId);
    if (bucket) {
      bucket.push(draft);
    } else {
      childrenOf.set(parentId, [draft]);
    }
  }

  const flat: FlatCategory[] = [];
  for (const root of childrenOf.get("") ?? []) {
    const children = childrenOf.get(root.id) ?? [];
    flat.push({ draft: root, depth: 0, parentId: "", childCount: children.length });
    for (const child of children) {
      flat.push({ draft: child, depth: 1, parentId: root.id, childCount: 0 });
    }
  }
  return flat;
}

type CategoryForest = {
  roots: WikiCategoryDraft[];
  childrenOf: Map<string, WikiCategoryDraft[]>;
};

function toForest(flat: FlatCategory[]): CategoryForest {
  const roots: WikiCategoryDraft[] = [];
  const childrenOf = new Map<string, WikiCategoryDraft[]>();
  for (const entry of flat) {
    if (entry.depth === 0) {
      roots.push(entry.draft);
      childrenOf.set(entry.draft.id, []);
      continue;
    }
    childrenOf.get(entry.parentId)?.push(entry.draft);
  }
  return { roots, childrenOf };
}

/** 摊回草稿数组：parent_id 按树上的实际位置改写，sort_order 取深度优先的下标。 */
function fromForest({ roots, childrenOf }: CategoryForest): WikiCategoryDraft[] {
  const next: WikiCategoryDraft[] = [];
  for (const root of roots) {
    next.push({ ...root, parent_id: "", sort_order: next.length });
    for (const child of childrenOf.get(root.id) ?? []) {
      next.push({ ...child, parent_id: root.id, sort_order: next.length });
    }
  }
  return next;
}

/**
 * 把草稿数组理成深度优先顺序，但一个 sort_order 都不改。
 * 打开编辑器时用：库里的序号可能让父子交错（子级的序号比父级小），界面要按树显示，
 * 数组顺序就得先对齐。此时若顺手重排序号，编辑器一打开保存按钮就亮，
 * 用户什么都没动却被告知有改动。序号留到真的挪了位置再重算。
 */
export function orderCategoryDrafts(drafts: WikiCategoryDraft[]): WikiCategoryDraft[] {
  return flattenCategoryDrafts(drafts).map((entry) => entry.draft);
}

/**
 * 这一行能不能挂到 parentId 底下。
 * 顶层永远可以；挂给别人则要求对方是顶层、不是自己，且自己底下没挂人——
 * 带着子级挂过去就是三层。
 */
export function canNestCategory(flat: FlatCategory[], categoryId: string, parentId: string): boolean {
  if (!parentId) {
    return true;
  }
  if (parentId === categoryId) {
    return false;
  }
  const entry = flat.find((item) => item.draft.id === categoryId);
  const parent = flat.find((item) => item.draft.id === parentId);
  if (!entry || !parent) {
    return false;
  }
  return parent.depth === 0 && entry.childCount === 0;
}

type ProjectionParams = {
  /** 拖拽期间界面上真实可见的那一列（被拖那行的子级已经收起来跟着走了）。 */
  items: FlatCategory[];
  activeId: string;
  overId: string;
  /** 指针相对按下位置的横向位移。 */
  offsetX: number;
  indentWidth: number;
};

/**
 * 算出这一放会落到哪儿。
 *
 * 竖着拖决定落在第几行，横着拖决定落在第几层——这是 dnd-kit 那套树的通行做法：
 * 层级不靠「精准命中某一行的行体」，而靠缩进量，靶面是整行宽，手抖不会在
 * 「挂进去」和「排在旁边」之间来回跳。
 *
 * 层级会被上下两个邻居夹住：往深不能超过上一行的层级 + 1（也不能超过两层封顶，
 * 自己底下还挂着人时更是只能停在顶层），往浅不能浅过下一行，否则下一行会莫名其妙
 * 变成自己的子级。夹的结果就是反馈本身：拖过头时那一行不再继续缩进，
 * 用户看得见「到头了」，而不是放手之后才发现被服务端拒了。
 */
export function projectCategoryMove({
  items,
  activeId,
  overId,
  offsetX,
  indentWidth,
}: ProjectionParams): CategoryMove | null {
  const moved = items.find((item) => item.draft.id === activeId);
  const overIndex = items.findIndex((item) => item.draft.id === overId);
  if (!moved || overIndex === -1) {
    return null;
  }

  const ordered = [...items];
  ordered.splice(items.indexOf(moved), 1);
  ordered.splice(overIndex, 0, moved);

  const previous = ordered[overIndex - 1];
  const next = ordered[overIndex + 1];

  const maxDepth = previous && moved.childCount === 0
    ? Math.min(CATEGORY_TREE_MAX_DEPTH, previous.depth + 1)
    : 0;
  const minDepth = next ? next.depth : 0;
  const requested = moved.depth + Math.round(offsetX / indentWidth);
  const depth = Math.min(maxDepth, Math.max(minDepth, requested, 0));

  let parentId = "";
  if (depth > 0 && previous) {
    parentId = previous.depth === 0 ? previous.draft.id : previous.parentId;
  }

  /*
   * 这一层里排第几：数落点前面有多少个同爹的行。被拖那行自己在 overIndex 上，
   * 数不到；它的子级已经不在 items 里。所以前面这些行的父级都还是拖动前那个，
   * 直接拿来数就是对的。
   */
  let index = 0;
  for (let cursor = 0; cursor < overIndex; cursor += 1) {
    if (ordered[cursor]?.parentId === parentId) {
      index += 1;
    }
  }

  return { parentId, index };
}

/**
 * 把一次移动落到草稿上。
 *
 * 投影已经把非法落点夹掉了，这里再验一遍纯粹是防御：真有哪条路绕过去，
 * 就原样返回，界面上那一行弹回原位——用户看得见这一下没生效，
 * 不会拿着一份界面和服务端对不上的草稿去按保存。
 */
export function applyCategoryMove(
  drafts: WikiCategoryDraft[],
  categoryId: string,
  move: CategoryMove,
): WikiCategoryDraft[] {
  const flat = flattenCategoryDrafts(drafts);
  const entry = flat.find((item) => item.draft.id === categoryId);
  if (!entry || !canNestCategory(flat, categoryId, move.parentId)) {
    return drafts;
  }

  const forest = toForest(flat);
  const detachedChildren = forest.childrenOf.get(categoryId) ?? [];

  if (entry.depth === 0) {
    const position = forest.roots.findIndex((draft) => draft.id === categoryId);
    if (position >= 0) {
      forest.roots.splice(position, 1);
    }
    forest.childrenOf.delete(categoryId);
  } else {
    const siblings = forest.childrenOf.get(entry.parentId);
    const position = siblings?.findIndex((draft) => draft.id === categoryId) ?? -1;
    if (position >= 0) {
      siblings?.splice(position, 1);
    }
  }

  const target = move.parentId ? forest.childrenOf.get(move.parentId) : forest.roots;
  if (!target) {
    return drafts;
  }
  target.splice(Math.max(0, Math.min(move.index, target.length)), 0, entry.draft);
  if (!move.parentId) {
    forest.childrenOf.set(categoryId, detachedChildren);
  }

  const next = fromForest(forest);
  /*
   * 原地放手（按一下拖拽柄就松开）也会走到这里，落点算出来跟原来一模一样。
   * 此时不能返回新数组：fromForest 会把 sort_order 重排成密集下标，
   * 于是「什么都没动」的一下点击把保存按钮点亮了。结构没变就原样退回。
   */
  const unchanged = next.every(
    (item, index) => item.id === drafts[index]?.id && item.parent_id === (drafts[index]?.parent_id ?? ""),
  );
  return unchanged ? drafts : next;
}

/** 键盘路径：把这一行挂到上一个顶层分类底下，排在它现有子级的最后。够不着就返回 null。 */
export function getIndentMove(drafts: WikiCategoryDraft[], categoryId: string): CategoryMove | null {
  const flat = flattenCategoryDrafts(drafts);
  const entry = flat.find((item) => item.draft.id === categoryId);
  if (!entry || entry.depth !== 0 || entry.childCount > 0) {
    return null;
  }
  const roots = flat.filter((item) => item.depth === 0);
  const position = roots.findIndex((item) => item.draft.id === categoryId);
  /* 第一行没有上一行可挂，position 为 0 时这里就取不到爹。 */
  const parent = position > 0 ? roots[position - 1] : undefined;
  if (!parent) {
    return null;
  }
  return { parentId: parent.draft.id, index: parent.childCount };
}

/** 键盘路径：把这一行提回顶层，排在原来那个爹的紧后面。已经在顶层就返回 null。 */
export function getOutdentMove(drafts: WikiCategoryDraft[], categoryId: string): CategoryMove | null {
  const flat = flattenCategoryDrafts(drafts);
  const entry = flat.find((item) => item.draft.id === categoryId);
  if (!entry || entry.depth === 0) {
    return null;
  }
  const roots = flat.filter((item) => item.depth === 0);
  return { parentId: "", index: roots.findIndex((item) => item.draft.id === entry.parentId) + 1 };
}

import type { ClassCatalogItem, ClassTag } from "@guild/shared";

const NO_CLASS_CATALOG_ITEM: ClassCatalogItem = {
  id: "",
  label: "-",
  color: "#8C94A3",
  icon_type: "vector",
  vector_icon: "sword",
  icon_media_id: null,
  sort_order: 100_000,
  created_at: "",
  updated_at: "",
};

export function compareClassCatalogItems(
  left: Pick<ClassCatalogItem, "sort_order" | "label">,
  right: Pick<ClassCatalogItem, "sort_order" | "label">,
): number {
  return left.sort_order - right.sort_order || left.label.localeCompare(right.label);
}

export function compareClassTags(
  left: Pick<ClassTag, "sort_order" | "label">,
  right: Pick<ClassTag, "sort_order" | "label">,
): number {
  return left.sort_order - right.sort_order || left.label.localeCompare(right.label);
}

/*
 * 目录与成员数据各自拉取、各自刷新：别的会话刚新增的职业会先出现在成员数据里、
 * 后出现在本地目录缓存里。未知 id 必须以原始 id 可见降级渲染——抛错会在渲染期
 * 直达顶层 ErrorBoundary，整页崩溃。删除方向由数据库 FK RESTRICT 保证不会出现
 * 悬空引用，所以降级项只会短暂存在于缓存追平之前。
 */
export function resolveClassCatalogItem(
  id: string | null | undefined,
  items: readonly ClassCatalogItem[],
): ClassCatalogItem {
  if (!id) return NO_CLASS_CATALOG_ITEM;
  const item = items.find((candidate) => candidate.id === id);
  if (item) return item;
  return { ...NO_CLASS_CATALOG_ITEM, id, label: id };
}

export function buildClassOptions(
  items: readonly ClassCatalogItem[],
): Array<{ value: string; label: string }> {
  return items.map((item) => ({ value: item.id, label: item.label }));
}

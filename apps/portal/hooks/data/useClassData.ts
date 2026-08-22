import type { ClassCatalogItem, ClassTag } from "@guild/shared";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../api/query-keys";
import { fetchClassTags } from "../../api/queries/class-tags";
import { fetchClassCatalog } from "../../api/queries/classes";
import { compareClassCatalogItems, compareClassTags } from "../../utils/class-catalog";

/*
 * 职业目录与标签的唯一数据源。bootstrap 启动时用这两份 options 预热缓存，
 * 管理页的增删改写的也是同一个 queryKey，所以全站读到的永远是最新一次写入。
 */
export const classCatalogQueryOptions = {
  queryKey: queryKeys.classes.list(),
  queryFn: fetchClassCatalog,
} as const;

export const classTagsQueryOptions = {
  queryKey: queryKeys.classTags.list(),
  queryFn: fetchClassTags,
} as const;

/* select 必须是模块级的稳定引用，TanStack 才会按输入记忆化排序结果；写成
   内联箭头函数的话每次渲染都会生成新数组，等于打掉所有下游 memo。 */
const sortClassCatalog = (items: ClassCatalogItem[]): ClassCatalogItem[] =>
  [...items].sort(compareClassCatalogItems);

const sortClassTags = (tags: ClassTag[]): ClassTag[] => [...tags].sort(compareClassTags);

const EMPTY_CATALOG: ClassCatalogItem[] = [];
const EMPTY_TAGS: ClassTag[] = [];

export function useClassCatalog(): ClassCatalogItem[] {
  const { data } = useQuery({ ...classCatalogQueryOptions, select: sortClassCatalog });
  return data ?? EMPTY_CATALOG;
}

/* 标签没有内置兜底值：职业目录有一份出厂配置可以垫着，标签完全是公会自己定
   的，编不出合理默认。缓存为空就照实返回空数组，编辑器会如实说「还没有标签」。 */
export function useClassTags(): ClassTag[] {
  const { data } = useQuery({ ...classTagsQueryOptions, select: sortClassTags });
  return data ?? EMPTY_TAGS;
}

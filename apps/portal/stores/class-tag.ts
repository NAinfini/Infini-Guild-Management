import type { ClassTag } from "@guild/shared";
import { create } from "zustand";

/*
 * 职业标签目录。跟 class-catalog 那个 store 一样在启动时灌一次，配额编辑器和筹码都从
 * 这里取。
 *
 * 初值是空数组，没有内置的兜底标签：职业目录有一份出厂配置可以垫着，标签则完全是公会
 * 自己定的，编不出合理的默认值。没加载出来就是空的，编辑器会照实说「还没有标签」。
 */
type ClassTagState = {
  tags: ClassTag[];
  setTags: (tags: ClassTag[]) => void;
};

export const useClassTagStore = create<ClassTagState>((set) => ({
  tags: [],
  setTags: (tags) => set({ tags: [...tags].sort(compareClassTags) }),
}));

export function compareClassTags(
  left: Pick<ClassTag, "sort_order" | "label">,
  right: Pick<ClassTag, "sort_order" | "label">,
): number {
  return left.sort_order - right.sort_order || left.label.localeCompare(right.label);
}

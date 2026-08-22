import { CSS, type Transform } from "@dnd-kit/utilities";

/*
 * 纵向排序清单的拖拽位移。
 *
 * dnd-kit 的 transform 同时带 x 和 y：指针横向移动多少，行就跟着平移多少。
 * 用 verticalListSortingStrategy 的清单只有上下一个自由度，横向位移不对应任何
 * 可能的落点，拖着拖着行就飘出容器，看起来像"一直往右跑"。
 * 落点由 y 决定，所以这里只保留 y。
 */
export function verticalDragTransform(transform: Transform | null): string | undefined {
  return CSS.Transform.toString(transform && { ...transform, x: 0 });
}

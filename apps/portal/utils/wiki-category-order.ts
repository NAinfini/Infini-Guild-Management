import type { WikiCategoryDraft } from "@portal/types/wiki";

export function reorderCategoryDrafts(
  drafts: WikiCategoryDraft[],
  activeId: string,
  overId: string,
): WikiCategoryDraft[] {
  const activeIndex = drafts.findIndex((draft) => draft.id === activeId);
  const overIndex = drafts.findIndex((draft) => draft.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return drafts;

  const next = [...drafts];
  const [active] = next.splice(activeIndex, 1);
  if (!active) return drafts;
  next.splice(overIndex, 0, active);
  return next.map((draft, sortOrder) => ({ ...draft, sort_order: sortOrder }));
}

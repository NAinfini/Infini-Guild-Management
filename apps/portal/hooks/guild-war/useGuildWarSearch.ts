import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { DragMemberColumn } from "./useGuildWarDragData";

function toMemberDomId(itemId: string): string {
  return `guild-war-member-${itemId.replace(/[:]/g, "-")}`;
}

type UseGuildWarSearchParams = {
  activeSearch: string;
  searchJumpIndex: number;
  setSearchJumpIndex: Dispatch<SetStateAction<number>>;
  selectedEventId: string | undefined;
  dragColumns: DragMemberColumn[];
};

export function useGuildWarSearch({
  activeSearch,
  searchJumpIndex,
  setSearchJumpIndex,
  selectedEventId,
  dragColumns,
}: UseGuildWarSearchParams) {
  const normalizedActiveSearch = activeSearch.trim().toLowerCase();

  const matchedItemIds = useMemo(() => {
    if (!normalizedActiveSearch) return [] as string[];
    return dragColumns.flatMap((column) =>
      column.members
        .filter((member) =>
          `${member.display_name} ${member.subtitle}`.toLowerCase().includes(normalizedActiveSearch),
        )
        .map((member) => member.itemId),
    );
  }, [dragColumns, normalizedActiveSearch]);

  const activeMatchIndex =
    matchedItemIds.length > 0
      ? ((searchJumpIndex % matchedItemIds.length) + matchedItemIds.length) % matchedItemIds.length
      : 0;

  const activeMatchedItemId = matchedItemIds.length > 0 ? matchedItemIds[activeMatchIndex] : null;

  useEffect(() => {
    setSearchJumpIndex(0);
  }, [normalizedActiveSearch, selectedEventId, setSearchJumpIndex]);

  useEffect(() => {
    if (!activeMatchedItemId) return;
    const element = document.getElementById(toMemberDomId(activeMatchedItemId));
    if (!element) return;
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [activeMatchedItemId]);

  return {
    matchedItemIds,
    activeMatchIndex,
    toMemberDomId,
  };
}

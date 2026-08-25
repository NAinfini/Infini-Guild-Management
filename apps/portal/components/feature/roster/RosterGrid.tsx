import type { MemberProfile, User, UserBadge } from "@guild/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { MemberCard } from "../../shared/MemberCard";
import { resolveMediaUrl } from "../../../utils/media";

type RosterEntry = { user: User; profile: MemberProfile; badges?: UserBadge[] };

function chunkEntries(entries: RosterEntry[], columns: number): RosterEntry[][] {
  if (columns <= 1) return entries.map((entry) => [entry]);
  const rows: RosterEntry[][] = [];
  for (let index = 0; index < entries.length; index += columns) {
    rows.push(entries.slice(index, index + columns));
  }
  return rows;
}

function resolveVirtualColumnCount(containerWidth: number): number {
  if (typeof window === "undefined" || window.innerWidth <= 575) return 1;

  const compactCards = window.innerWidth <= 767;
  const cardMinimum = compactCards ? 150 : 200;
  const horizontalPadding = compactCards ? 24 : 32;
  const gap = 8;
  const availableWidth = Math.max(containerWidth - horizontalPadding, cardMinimum);

  return Math.max(1, Math.floor((availableWidth + gap) / (cardMinimum + gap)));
}

type Props = {
  rows: RosterEntry[];
  shouldVirtualize: boolean;
  ariaLabel: string;
  onCardClick: (entry: RosterEntry) => void;
  onCardMouseEnter: (entry: RosterEntry) => void;
  onCardMouseLeave: () => void;
  onCardFocus: (entry: RosterEntry) => void;
  onCardBlur: (event: FocusEvent<HTMLDivElement>) => void;
};

export function RosterGrid({
  rows,
  shouldVirtualize,
  ariaLabel,
  onCardClick,
  onCardMouseEnter,
  onCardMouseLeave,
  onCardFocus,
  onCardBlur,
}: Props) {
  const virtualScrollRef = useRef<HTMLDivElement | null>(null);
  const [virtualContainerWidth, setVirtualContainerWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const columnCount = resolveVirtualColumnCount(virtualContainerWidth);
  const rowChunks = useMemo(() => chunkEntries(rows, columnCount), [rows, columnCount]);

  useEffect(() => {
    if (!shouldVirtualize) return;

    const scrollElement = virtualScrollRef.current;
    if (!scrollElement) return;

    const measureWidth = () => {
      const nextWidth = Math.round(scrollElement.getBoundingClientRect().width);
      if (nextWidth > 0) setVirtualContainerWidth(nextWidth);
    };

    measureWidth();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measureWidth);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [shouldVirtualize]);
  const handlePointerEnter = (event: PointerEvent<HTMLDivElement>, entry: RosterEntry) => {
    if (event.pointerType === "mouse") onCardMouseEnter(entry);
  };
  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") onCardMouseLeave();
  };

  const rowVirtualizer = useVirtualizer({
    count: rowChunks.length,
    getScrollElement: () => virtualScrollRef.current,
    estimateSize: () => 280,
    overscan: 6,
    gap: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  if (shouldVirtualize) {
    /*
     * list/listitem, not grid/gridcell: role="grid" requires role="row"
     * children, and the columns here are pure visual reflow with no column
     * semantics to navigate.
     */
    return (
      <div ref={virtualScrollRef} className="roster-grid-region roster-virtual-scroll" role="list" aria-label={ariaLabel}>
        <div className="roster-virtual-inner" style={{ height: rowVirtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const members = rowChunks[virtualRow.index] ?? [];
            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className="roster-virtual-row"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                }}
              >
                {members.map((entry) => (
                  <div key={entry.user.id} role="listitem" className="roster-virtual-cell">
                    <div
                      className="roster-card-interaction"
                      onPointerEnter={(event) => handlePointerEnter(event, entry)}
                      onPointerLeave={handlePointerLeave}
                      onFocus={() => onCardFocus(entry)}
                      onBlur={onCardBlur}
                    >
                      <MemberCard
                        user={entry.user}
                        profile={entry.profile}
                        badges={entry.badges}
                        resolveMediaUrl={resolveMediaUrl}
                        onClick={() => onCardClick(entry)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="roster-grid-region" role="list" aria-label={ariaLabel}>
      <div className="roster-card-grid">
        {rows.map((entry) => (
          <div key={entry.user.id} role="listitem" className="roster-card-cell">
            <div
              className="roster-card-interaction"
              onPointerEnter={(event) => handlePointerEnter(event, entry)}
              onPointerLeave={handlePointerLeave}
              onFocus={() => onCardFocus(entry)}
              onBlur={onCardBlur}
            >
              <MemberCard
                user={entry.user}
                profile={entry.profile}
                badges={entry.badges}
                resolveMediaUrl={resolveMediaUrl}
                onClick={() => onCardClick(entry)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

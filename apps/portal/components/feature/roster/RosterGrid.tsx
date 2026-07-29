import type { MemberProfile, User, UserBadge } from "@guild/shared";
import { StaggerList } from "@portal/components/effects";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "motion/react";
import { useMemo, useRef, type FocusEvent, type PointerEvent } from "react";
import { MemberCard } from "../../shared/MemberCard";
import { resolveProfileMediaUrl } from "../../../utils/media";

type RosterEntry = { user: User; profile: MemberProfile; badges?: UserBadge[] };

const rosterCardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
} as const;

function chunkEntries(entries: RosterEntry[], columns: number): RosterEntry[][] {
  if (columns <= 1) return entries.map((entry) => [entry]);
  const rows: RosterEntry[][] = [];
  for (let index = 0; index < entries.length; index += columns) {
    rows.push(entries.slice(index, index + columns));
  }
  return rows;
}

type Props = {
  rows: RosterEntry[];
  shouldVirtualize: boolean;
  columnCount: number;
  staggerKey: string;
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
  columnCount,
  staggerKey,
  ariaLabel,
  onCardClick,
  onCardMouseEnter,
  onCardMouseLeave,
  onCardFocus,
  onCardBlur,
}: Props) {
  const virtualScrollRef = useRef<HTMLDivElement | null>(null);
  const rowChunks = useMemo(() => chunkEntries(rows, columnCount), [rows, columnCount]);
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
      <div ref={virtualScrollRef} className="roster-virtual-scroll" role="list" aria-label={ariaLabel}>
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
                      onPointerEnter={(event) => handlePointerEnter(event, entry)}
                      onPointerLeave={handlePointerLeave}
                      onFocus={() => onCardFocus(entry)}
                      onBlur={onCardBlur}
                    >
                      <MemberCard
                        user={entry.user}
                        profile={entry.profile}
                        badges={entry.badges}
                        resolveMediaUrl={resolveProfileMediaUrl}
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
    <div role="list" aria-label={ariaLabel}>
      <StaggerList className="roster-card-grid" staggerMs={30} key={staggerKey}>
        {rows.map((entry) => (
          <motion.div key={entry.user.id} role="listitem" variants={rosterCardVariants} className="roster-card-cell">
            <div
              onPointerEnter={(event) => handlePointerEnter(event, entry)}
              onPointerLeave={handlePointerLeave}
              onFocus={() => onCardFocus(entry)}
              onBlur={onCardBlur}
            >
              <MemberCard
                user={entry.user}
                profile={entry.profile}
                badges={entry.badges}
                resolveMediaUrl={resolveProfileMediaUrl}
                onClick={() => onCardClick(entry)}
              />
            </div>
          </motion.div>
        ))}
      </StaggerList>
    </div>
  );
}

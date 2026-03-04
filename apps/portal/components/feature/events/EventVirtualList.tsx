import type { Event } from "@guild/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Stack } from "@mantine/core";
import { useRef, type ReactNode } from "react";
import { EmptyState } from "../../shared/EmptyState";

type EventVirtualListProps = {
  events: Event[];
  renderItem: (event: Event) => ReactNode;
  emptyText: string;
  maxHeight?: number;
};

export function EventVirtualList({ events, renderItem, emptyText, maxHeight = 340 }: EventVirtualListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = events.length > 20;
  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 84,
    overscan: 6,
    gap: 8,
  });

  if (events.length === 0) {
    return <EmptyState title={emptyText} />;
  }

  if (!shouldVirtualize) {
    return (
      <Stack gap={8}>
        {events.map((event) => renderItem(event))}
      </Stack>
    );
  }

  return (
    <div ref={scrollRef} style={{ maxHeight, overflowY: "auto" }} role="list" aria-label="Virtualized event list">
      <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const event = events[virtualRow.index];
          if (!event) {
            return null;
          }
          return (
            <div
              key={virtualRow.key}
              role="listitem"
              style={{
                position: "absolute",
                insetInline: 0,
                top: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(event)}
            </div>
          );
        })}
      </div>
    </div>
  );
}


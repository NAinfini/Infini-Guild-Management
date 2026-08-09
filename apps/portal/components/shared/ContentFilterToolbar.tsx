import { Badge, Button, Drawer, Paper, Popover, Text, type PaperProps } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import "./ContentFilterToolbar.css";

type ContentFilterToolbarProps = {
  search: ReactNode;
  controls: ReactNode;
  toggleLabel: string;
  primary?: ReactNode;
  activeSummary?: ReactNode;
  activeFilterCount?: number;
  collapseBelow?: number;
  withBorder?: boolean;
  padding?: PaperProps["p"];
  className?: string;
};

const DEFAULT_COLLAPSE_BELOW = 1088;

export function ContentFilterToolbar({
  search,
  controls,
  toggleLabel,
  primary,
  activeSummary,
  activeFilterCount = 0,
  collapseBelow = DEFAULT_COLLAPSE_BELOW,
  withBorder = true,
  padding = "sm",
  className,
}: ContentFilterToolbarProps) {
  const controlsId = useId();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const [opened, setOpened] = useState(false);
  const [isCompact, setIsCompact] = useState(true);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const updateWidth = (width: number) => {
      setIsCompact(width < collapseBelow);
    };

    updateWidth(toolbar.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [collapseBelow]);

  useEffect(() => {
    if (!isCompact) setOpened(false);
  }, [isCompact]);

  const controlsContent = (
    <div className="content-filter-toolbar__panel-controls">{controls}</div>
  );

  const toggleAccessibleLabel = activeFilterCount > 0
    ? `${toggleLabel} (${activeFilterCount})`
    : toggleLabel;
  const renderToggleButton = (ariaControls?: string) => (
    <Button
      className="content-filter-toolbar__toggle"
      variant={opened ? "light" : "default"}
      leftSection={<IconAdjustmentsHorizontal size={17} />}
      onClick={() => setOpened((value) => !value)}
      aria-label={toggleAccessibleLabel}
      aria-expanded={opened}
      aria-controls={ariaControls}
    >
      <span>{toggleLabel}</span>
      {activeFilterCount > 0 ? (
        <Badge className="content-filter-toolbar__count" size="sm" variant="filled" aria-hidden="true">
          {activeFilterCount}
        </Badge>
      ) : null}
    </Button>
  );

  return (
    <Paper
      ref={toolbarRef}
      withBorder={withBorder}
      radius="md"
      p={padding}
      className={["content-filter-toolbar", className].filter(Boolean).join(" ")}
    >
      <div className="content-filter-toolbar__layout" data-compact={isCompact}>
        <div className="content-filter-toolbar__search">{search}</div>

        {!isCompact ? (
          <div id={controlsId} className="content-filter-toolbar__controls">
            {controls}
          </div>
        ) : isMobile ? (
          <div className="content-filter-toolbar__toggle-slot">
            {renderToggleButton(controlsId)}
            <Drawer
              opened={opened}
              onClose={() => setOpened(false)}
              position="bottom"
              size="auto"
              title={toggleLabel}
              closeOnEscape
              returnFocus
              trapFocus
              classNames={{
                content: "content-filter-toolbar__drawer-content",
                body: "content-filter-toolbar__drawer-body",
              }}
            >
              <div id={controlsId}>{controlsContent}</div>
            </Drawer>
          </div>
        ) : (
          <div className="content-filter-toolbar__toggle-slot">
            <Popover
              opened={opened}
              onChange={setOpened}
              position="bottom-end"
              width={380}
              shadow="lg"
              withArrow
              withinPortal
              closeOnEscape
              returnFocus
              trapFocus
            >
              <Popover.Target>{renderToggleButton()}</Popover.Target>
              <Popover.Dropdown
                role="dialog"
                aria-label={toggleLabel}
                className="content-filter-toolbar__popover"
              >
                {controlsContent}
              </Popover.Dropdown>
            </Popover>
          </div>
        )}

        {primary ? <div className="content-filter-toolbar__primary">{primary}</div> : null}

        {isCompact && !opened && activeSummary ? (
          <Text className="content-filter-toolbar__summary" size="xs" c="dimmed">
            {activeSummary}
          </Text>
        ) : null}
      </div>
    </Paper>
  );
}

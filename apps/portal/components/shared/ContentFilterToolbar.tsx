import { IconAdjustmentsHorizontal, IconX } from "@tabler/icons-react";
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@portal/components/ui/drawer";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@portal/components/ui/popover";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { cn } from "@portal/lib/utils";
import "./ContentFilterToolbar.css";

type ContentFilterToolbarProps = {
  search: ReactNode;
  filterControls: ReactNode;
  filterLabel: string;
  filterActions?: ReactNode;
  resetLabel?: string;
  onReset?: () => void;
  view?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  activeFilterCount?: number;
  surface?: "raised" | "bare";
  className?: string;
};

type ContentFilterGroupProps = {
  label: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  className?: string;
};

type ContentFilterOptionProps = ComponentPropsWithoutRef<"label">;

/**
 * One full-row choice inside a filter group. Wrapping the native/Base UI
 * control keeps the whole row clickable while preserving its input semantics.
 */
export function ContentFilterOption({
  className,
  ...props
}: ContentFilterOptionProps) {
  return (
    <label
      className={cn("content-filter-toolbar__option", className)}
      {...props}
    />
  );
}

/**
 * A visible, named group inside the one shared filter surface. The control
 * inside owns its own input semantics; this wrapper supplies the common
 * heading, boundary, and spacing used by every collection route.
 */
export function ContentFilterGroup({
  label,
  children,
  description,
  className,
}: ContentFilterGroupProps) {
  const labelId = useId();

  return (
    <section
      className={cn("content-filter-toolbar__filter-group", className)}
      aria-labelledby={labelId}
    >
      <div className="content-filter-toolbar__filter-group-heading">
        <span id={labelId} className="content-filter-toolbar__filter-group-title">
          {label}
        </span>
        {description ? (
          <span className="content-filter-toolbar__filter-group-description">
            {description}
          </span>
        ) : null}
      </div>
      <div className="content-filter-toolbar__filter-group-content">{children}</div>
    </section>
  );
}

export function ContentFilterToolbar({
  search,
  filterControls,
  filterLabel,
  filterActions,
  resetLabel,
  onReset,
  view,
  actions,
  summary,
  activeFilterCount = 0,
  surface = "raised",
  className,
}: ContentFilterToolbarProps) {
  const { t } = useTranslation("common");
  const filtersId = useId();
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const hasActiveFilters = activeFilterCount > 0;
  const hasAuxiliarySlots = Boolean(view || actions || summary);
  const toggleAccessibleLabel = hasActiveFilters
    ? `${filterLabel} (${activeFilterCount})`
    : filterLabel;

  useEffect(() => {
    setOpened(false);
  }, [isMobile]);

  const toggleContents = (
    <>
      <IconAdjustmentsHorizontal aria-hidden="true" size={17} />
      <span className="content-filter-toolbar__toggle-label">{filterLabel}</span>
      {hasActiveFilters ? (
        <Badge className="content-filter-toolbar__count" aria-hidden="true">
          {activeFilterCount}
        </Badge>
      ) : null}
    </>
  );

  const panelHeading = (title: ReactNode, closeAction?: ReactNode) => (
    <div className="content-filter-toolbar__panel-heading">
      {title}
      <div className="content-filter-toolbar__panel-heading-actions">
        {hasActiveFilters ? (
          <Badge
            className="content-filter-toolbar__panel-count"
            variant="secondary"
            aria-hidden="true"
          >
            {activeFilterCount}
          </Badge>
        ) : null}
        {hasActiveFilters && onReset && resetLabel ? (
          <Button
            variant="ghost"
            size="sm"
            className="content-filter-toolbar__reset"
            onClick={onReset}
          >
            {resetLabel}
          </Button>
        ) : null}
        {closeAction}
      </div>
    </div>
  );

  const panelBody = (
    <ScrollArea className="content-filter-toolbar__panel-scroll-area">
      <div className="content-filter-toolbar__panel">
        <div className="content-filter-toolbar__panel-controls">{filterControls}</div>
        {filterActions ? (
          <div className="content-filter-toolbar__panel-action-rail">{filterActions}</div>
        ) : null}
      </div>
    </ScrollArea>
  );

  const toggleButton = (
    <Button
      ref={filterTriggerRef}
      variant="outline"
      className="content-filter-toolbar__toggle"
      aria-label={toggleAccessibleLabel}
    />
  );

  return (
    <section
      className={cn(
        "content-filter-toolbar",
        `content-filter-toolbar--${surface}`,
        className,
      )}
      aria-label={filterLabel}
    >
      <div
        className={cn(
          "content-filter-toolbar__layout",
          !hasAuxiliarySlots && "content-filter-toolbar__layout--filter-only",
        )}
      >
        <div className="content-filter-toolbar__search">{search}</div>
        <div className="content-filter-toolbar__footer">
          {summary ? <div className="content-filter-toolbar__summary">{summary}</div> : null}
          <div className="content-filter-toolbar__tools">
            {isMobile ? (
              <Drawer
                open={opened}
                onOpenChange={(nextOpen) => setOpened(nextOpen)}
                swipeDirection="down"
                triggerId={filtersId}
              >
                <DrawerTrigger id={filtersId} render={toggleButton}>
                  {toggleContents}
                </DrawerTrigger>
                <DrawerContent id={`${filtersId}-drawer`} className="content-filter-toolbar__drawer-content">
                  <DrawerHeader className="content-filter-toolbar__drawer-header">
                    <div className="content-filter-toolbar__drawer-heading-row">
                      {panelHeading(
                        <DrawerTitle className="content-filter-toolbar__drawer-title">
                          {filterLabel}
                        </DrawerTitle>,
                      )}
                      <DrawerClose
                        aria-label={t("action.close")}
                        render={<Button variant="ghost" size="icon-sm" className="content-filter-toolbar__drawer-close" />}
                      >
                        <IconX aria-hidden="true" size={18} />
                      </DrawerClose>
                    </div>
                  </DrawerHeader>
                  <div className="content-filter-toolbar__drawer-body">{panelBody}</div>
                </DrawerContent>
              </Drawer>
            ) : (
              <Popover
                open={opened}
                onOpenChange={(nextOpen, eventDetails) => {
                  setOpened(nextOpen);
                  if (!nextOpen && eventDetails.reason === "escape-key") {
                    requestAnimationFrame(() => {
                      filterTriggerRef.current?.focus({ preventScroll: true });
                    });
                  }
                }}
                triggerId={filtersId}
              >
                <PopoverTrigger id={filtersId} render={toggleButton}>
                  {toggleContents}
                </PopoverTrigger>
                <PopoverContent
                  className="content-filter-toolbar__popover"
                  align="end"
                  side="bottom"
                  sideOffset={8}
                >
                  <PopoverHeader className="content-filter-toolbar__popover-heading">
                    {panelHeading(
                      <PopoverTitle className="content-filter-toolbar__panel-title">
                        {filterLabel}
                      </PopoverTitle>,
                      <PopoverClose
                        aria-label={t("action.close")}
                        render={<Button variant="ghost" size="icon-sm" />}
                      >
                        <IconX aria-hidden="true" size={18} />
                      </PopoverClose>,
                    )}
                  </PopoverHeader>
                  {panelBody}
                </PopoverContent>
              </Popover>
            )}
            {view ? <div className="content-filter-toolbar__view">{view}</div> : null}
            {actions ? <div className="content-filter-toolbar__actions">{actions}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

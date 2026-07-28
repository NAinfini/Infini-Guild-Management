import { Tabs } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import "./PageTabs.css";

export type PageTabDefinition<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

type PageTabsProps<T extends string> = {
  tabs: readonly PageTabDefinition<T>[];
  defaultValue: T;
  children: ReactNode;
  searchKey?: string;
  keepMounted?: boolean;
  className?: string;
  listClassName?: string;
  listWrapper?: (list: ReactElement) => ReactNode;
  onChange?: (value: T) => void;
};

type CurrentRouteSearchNavigation = (options: {
  search: (previous: Record<string, unknown>) => Record<string, unknown>;
  replace: boolean;
  viewTransition: boolean;
}) => void;

export function PageTabs<T extends string>({
  tabs,
  defaultValue,
  children,
  searchKey = "tab",
  keepMounted = true,
  className,
  listClassName,
  listWrapper,
  onChange,
}: PageTabsProps<T>) {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const navigateCurrentSearch = navigate as unknown as CurrentRouteSearchNavigation;
  const listRef = useRef<HTMLDivElement>(null);
  const requestedValue = search[searchKey];
  const fallbackValue = tabs.some((tab) => tab.value === defaultValue)
    ? defaultValue
    : (tabs[0]?.value ?? null);
  const activeValue =
    typeof requestedValue === "string" && tabs.some((tab) => tab.value === requestedValue)
      ? (requestedValue as T)
      : fallbackValue;

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeValue]);

  if (!activeValue) {
    return null;
  }

  const handleChange = (nextValue: string | null) => {
    if (!nextValue || !tabs.some((tab) => tab.value === nextValue)) {
      return;
    }

    const value = nextValue as T;
    onChange?.(value);
    navigateCurrentSearch({
      search: (previous) => ({
        ...previous,
        [searchKey]: value === defaultValue ? undefined : value,
      }),
      replace: true,
      viewTransition: false,
    });
  };

  const list = (
    <Tabs.List ref={listRef} className={`page-tabs__list ${listClassName ?? ""}`.trim()}>
      {tabs.map((tab) => (
        <Tabs.Tab key={tab.value} value={tab.value} disabled={tab.disabled}>
          {tab.label}
        </Tabs.Tab>
      ))}
    </Tabs.List>
  );

  return (
    <Tabs
      value={activeValue}
      onChange={handleChange}
      keepMounted={keepMounted}
      className={`page-tabs ${className ?? ""}`.trim()}
    >
      {listWrapper ? listWrapper(list) : list}
      {children}
    </Tabs>
  );
}

export const PageTabPanel = Tabs.Panel;

import { Avatar, AvatarFallback } from "@portal/components/ui/avatar";
import { Input } from "@portal/components/ui/input";
import { CheckIcon, SearchIcon } from "@portal/components/icons";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";

export type AnalyticsListBoxItem = {
  value: string;
  label: string;
  Icon?: ComponentType<{ size?: number }>;
};

type GuildWarAnalyticsListBoxProps = {
  items: AnalyticsListBoxItem[];
  selected: string[];
  onChange: (values: string[]) => void;
  maxSelect?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  ariaLabel?: string;
  renderItem?: (item: AnalyticsListBoxItem, checked: boolean) => ReactNode;
};

export function GuildWarAnalyticsListBox({
  items,
  selected,
  onChange,
  maxSelect,
  searchable,
  searchPlaceholder,
  ariaLabel,
  renderItem,
}: GuildWarAnalyticsListBoxProps) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return items;
    const lower = search.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(lower));
  }, [items, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }
    if (maxSelect && selected.length >= maxSelect) return;
    onChange([...selected, value]);
  };

  return (
    <div className="gwa-listbox">
      {searchable ? (
        <div className="gwa-listbox__search">
          <SearchIcon className="gwa-listbox__search-icon" size={12} aria-hidden="true" />
          <Input
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
      ) : null}
      <div
        className="gwa-listbox__items"
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable="true"
      >
        {filtered.map((item) => {
          const checked = selected.includes(item.value);
          const disabled = Boolean(maxSelect && selected.length >= maxSelect && !checked);
          return (
            <button
              type="button"
              key={item.value}
              onClick={() => toggle(item.value)}
              className={`gwa-listbox__item ${checked ? "gwa-listbox__item--selected" : ""}`}
              role="option"
              aria-selected={checked}
              disabled={disabled}
            >
              {renderItem ? renderItem(item, checked) : <DefaultListBoxItem item={item} checked={checked} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type DefaultListBoxItemProps = {
  item: AnalyticsListBoxItem;
  checked: boolean;
};

function DefaultListBoxItem({ item, checked }: DefaultListBoxItemProps) {
  return (
    <span className="gwa-listbox__item-layout">
      <span className="gwa-listbox__item-main">
        {item.Icon ? <item.Icon size={14} /> : null}
        <span className="gwa-listbox__item-label">{item.label}</span>
      </span>
      {checked ? <CheckIcon size={12} /> : null}
    </span>
  );
}

type UserListBoxItemProps = {
  item: AnalyticsListBoxItem;
  checked: boolean;
};

export function UserListBoxItem({ item, checked }: UserListBoxItemProps) {
  return (
    <span className="gwa-listbox__item-layout">
      <span className="gwa-listbox__item-main">
        <Avatar className="size-5">
          <AvatarFallback>
          {item.label.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="gwa-listbox__item-label">{item.label}</span>
      </span>
      {checked ? <CheckIcon size={12} /> : null}
    </span>
  );
}

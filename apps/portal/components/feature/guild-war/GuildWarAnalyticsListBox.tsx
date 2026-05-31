import { Avatar, Group, TextInput, UnstyledButton } from "@mantine/core";
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
  renderItem?: (item: AnalyticsListBoxItem, checked: boolean) => ReactNode;
};

export function GuildWarAnalyticsListBox({
  items,
  selected,
  onChange,
  maxSelect,
  searchable,
  searchPlaceholder,
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
        <TextInput
          size="xs"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          leftSection={<SearchIcon size={12} />}
          className="gwa-listbox__search"
        />
      ) : null}
      <div className="gwa-listbox__items">
        {filtered.map((item) => {
          const checked = selected.includes(item.value);
          return (
            <UnstyledButton
              key={item.value}
              onClick={() => toggle(item.value)}
              className={`gwa-listbox__item ${checked ? "gwa-listbox__item--selected" : ""}`}
            >
              {renderItem ? renderItem(item, checked) : <DefaultListBoxItem item={item} checked={checked} />}
            </UnstyledButton>
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
    <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
      <Group gap={8}>
        {item.Icon ? <item.Icon size={14} /> : null}
        <span className="gwa-listbox__item-label">{item.label}</span>
      </Group>
      {checked ? <CheckIcon size={12} /> : null}
    </Group>
  );
}

type UserListBoxItemProps = {
  item: AnalyticsListBoxItem;
  checked: boolean;
};

export function UserListBoxItem({ item, checked }: UserListBoxItemProps) {
  return (
    <Group gap={8} style={{ justifyContent: "space-between", width: "100%" }}>
      <Group gap={8}>
        <Avatar size={20} radius="xl">
          {item.label.slice(0, 2).toUpperCase()}
        </Avatar>
        <span className="gwa-listbox__item-label">{item.label}</span>
      </Group>
      {checked ? <CheckIcon size={12} /> : null}
    </Group>
  );
}

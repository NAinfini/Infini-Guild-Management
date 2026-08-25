import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import "./PageSubnav.css";

export type PageSubnavItem<T extends string> = {
  value: T;
  label: string;
  indicator?: ReactNode;
  disabled?: boolean;
};

type PageSubnavProps<T extends string> = {
  value: T;
  items: readonly PageSubnavItem<T>[];
  label: string;
  onChange: (value: T) => void;
  className?: string;
};

/** Route-level task navigation. Query filters and view modes do not belong here. */
export function PageSubnav<T extends string>({
  value,
  items,
  label,
  onChange,
  className,
}: PageSubnavProps<T>) {
  if (items.length <= 1) return null;

  return (
    <div className={`page-subnav${className ? ` ${className}` : ""}`}>
      <nav className="page-subnav__rail" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            className="page-subnav__item"
            aria-current={item.value === value ? "page" : undefined}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
          >
            <span>{item.label}</span>
            {item.indicator ? <span className="page-subnav__indicator">{item.indicator}</span> : null}
          </button>
        ))}
      </nav>

      <Select
        value={value}
        items={items.map((item) => ({
          value: item.value,
          label: item.indicator ? `${item.label} •` : item.label,
          disabled: item.disabled,
        }))}
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue as T);
        }}
      >
        <SelectTrigger className="page-subnav__select" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
              {item.label}{item.indicator ? " •" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

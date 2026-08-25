import type { ReactNode } from "react";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import "./EntityNavigator.css";

export type EntityNavigatorItem = {
  value: string;
  label: string;
  parentValue?: string;
  mobileLabel?: string;
  disabled?: boolean;
};

type EntityNavigatorProps = {
  label: string;
  countLabel?: string;
  items: readonly EntityNavigatorItem[];
  value: string | null;
  onChange: (item: EntityNavigatorItem) => void;
  action?: ReactNode;
  className?: string;
};

/**
 * A dynamic record navigator. `items` is the single source for the desktop
 * hierarchy and compact Select so both devices choose the same entity.
 */
export function EntityNavigator({
  label,
  countLabel,
  items,
  value,
  onChange,
  action,
  className,
}: EntityNavigatorProps) {
  const isCompact = useMediaQuery("(max-width: 40em)") ?? false;
  const roots = items.filter((item) => !item.parentValue);
  const selectedItem = items.find((item) => item.value === value) ?? null;
  const selectedRootValue = selectedItem?.parentValue ?? selectedItem?.value ?? null;
  const compactItems = items.map((item) => ({
    value: item.value,
    label: item.mobileLabel ?? item.label,
    disabled: item.disabled,
  }));
  return (
    <section className={`entity-navigator${className ? ` ${className}` : ""}`} aria-label={label}>
      <div className="entity-navigator__heading">
        <div className="entity-navigator__label">
          <span>{label}</span>
          {countLabel ? <span className="entity-navigator__count">{countLabel}</span> : null}
        </div>
        {action ? <div className="entity-navigator__action">{action}</div> : null}
      </div>

      {isCompact ? (
        <Select
          value={value}
          items={compactItems}
          onValueChange={(nextValue) => {
            const nextItem = items.find((item) => item.value === nextValue);
            if (nextItem) onChange(nextItem);
          }}
        >
          <SelectTrigger className="entity-navigator__select" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                {item.mobileLabel ?? item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <nav className="entity-navigator__tree" aria-label={label}>
          {roots.map((root) => {
            const children = items.filter((item) => item.parentValue === root.value);
            const rootIsOpen = root.value === selectedRootValue;
            const rootIsCurrent = root.value === value;

            return (
              <div className="entity-navigator__branch" key={root.value}>
                <button
                  type="button"
                  className="entity-navigator__root"
                  data-open={rootIsOpen || undefined}
                  data-current={rootIsCurrent || undefined}
                  aria-current={rootIsCurrent ? "page" : undefined}
                  disabled={root.disabled}
                  onClick={() => onChange(root)}
                >
                  {root.label}
                </button>
                {rootIsOpen && children.length > 0 ? (
                  <div className="entity-navigator__children">
                    {children.map((child) => {
                      const childIsCurrent = child.value === value;
                      return (
                        <button
                          type="button"
                          className="entity-navigator__child"
                          data-current={childIsCurrent || undefined}
                          key={child.value}
                          aria-current={childIsCurrent ? "page" : undefined}
                          disabled={child.disabled}
                          onClick={() => onChange(child)}
                        >
                          {child.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      )}
    </section>
  );
}

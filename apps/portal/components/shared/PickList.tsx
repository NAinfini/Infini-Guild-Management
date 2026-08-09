import { Checkbox, Text, TextInput } from "@mantine/core";
import { SearchIcon } from "@portal/components/icons";
import type { ReactNode } from "react";
import "./PickList.css";

/*
 * Shared checkbox semantics for selecting records from a list. Filtering stays
 * with the caller so every row reflects the same visible option set.
 */

export type PickListOption = {
  id: string;
  /** 行的主文案，同时是这一行的无障碍名。 */
  label: string;
  /** 行首的图形：头像、职业图标之类。 */
  icon?: ReactNode;
  /** 行尾的附加信息：所属标签、授予时间之类。 */
  meta?: ReactNode;
  /** 除上限之外的单行禁用理由，由调用方给。 */
  disabled?: boolean;
};

export type PickListSection = {
  key: string;
  label: string;
  options: readonly PickListOption[];
};

type PickListProps = {
  /** 平铺清单。与 sections 二选一。 */
  options?: readonly PickListOption[];
  /** 分节清单。与 options 二选一。 */
  sections?: readonly PickListSection[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  /** 取消／保存之类。 */
  actions?: ReactNode;
  /** 一行都没有时显示的话；调用方自己区分「目录本来就空」和「搜没搜到」。 */
  emptyLabel: string;
  /** 勾选上限：到了之后没勾上的行一起禁用。理由请写进 status。 */
  max?: number;
  size?: "xs" | "sm";
  className?: string;
  "aria-label"?: string;
};

function PickRow({
  option,
  selected,
  disabled,
  size,
  onToggle,
}: {
  option: PickListOption;
  selected: boolean;
  disabled: boolean;
  size: "xs" | "sm";
  onToggle: (id: string) => void;
}) {
  return (
    <Checkbox
      className="pick-list__row pick-list__row--pick"
      size={size}
      checked={selected}
      disabled={disabled}
      onChange={() => onToggle(option.id)}
      aria-label={option.label}
      label={(
        <span className="pick-list__row-main">
          {option.icon ? <span className="pick-list__row-icon">{option.icon}</span> : null}
          <Text component="span" size={size} className="pick-list__row-label">{option.label}</Text>
          {option.meta ? <span className="pick-list__row-meta">{option.meta}</span> : null}
        </span>
      )}
    />
  );
}

export function PickList({
  options,
  sections,
  selected,
  onToggle,
  search,
  actions,
  emptyLabel,
  max,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: PickListProps) {
  const atMax = max !== undefined && selected.size >= max;
  const isEmpty = sections ? sections.length === 0 : (options?.length ?? 0) === 0;
  const rowOf = (option: PickListOption) => (
    <PickRow
      key={option.id}
      option={option}
      selected={selected.has(option.id)}
      disabled={Boolean(option.disabled) || (atMax && !selected.has(option.id))}
      size={size}
      onToggle={onToggle}
    />
  );

  return (
    <div className={className ? `pick-list ${className}` : "pick-list"}>
      {search || actions ? (
        <div className="pick-list__toolbar">
          {search ? (
            <TextInput
              className="pick-list__search"
              size={size}
              value={search.value}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              leftSection={<SearchIcon size={14} />}
              onChange={(event) => {
                /* 先当场取值：event 在 setState 的 updater 跑到时已经回收了。 */
                const { value } = event.currentTarget;
                search.onChange(value);
              }}
            />
          ) : null}
          {actions}
        </div>
      ) : null}

      {/* 清单本身不管高度：不封顶就是内容多高它多高，要封顶由调用方在自己的
          className 下写 .pick-list__body 的 max-block-size——那是版式，不是控件。 */}
      <div className="pick-list__body" role="group" aria-label={ariaLabel}>
        {isEmpty ? (
          <Text size="xs" c="dimmed" className="pick-list__empty">{emptyLabel}</Text>
        ) : sections ? (
          sections.map((section) => (
            <div key={section.key} className="pick-list__section">
              <div className="pick-list__section-head">
                <Text size="xs" fw={800} c="dimmed" truncate>{section.label}</Text>
              </div>
              {section.options.map(rowOf)}
            </div>
          ))
        ) : (
          options?.map(rowOf)
        )}
      </div>
    </div>
  );
}

/*
 * 只读的一行，长得和勾选行一模一样，只是没有勾选框。
 * 徽章页的查看态用它：切到编辑态时行高、分隔线、缩进都不动，只有内容变。
 */
export function PickListStaticRow({
  icon,
  label,
  meta,
}: {
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="pick-list__row">
      {icon ? <span className="pick-list__row-icon">{icon}</span> : null}
      <span className="pick-list__row-label">{label}</span>
      {meta ? <span className="pick-list__row-meta">{meta}</span> : null}
    </div>
  );
}

/** 只读行的外框，和勾选清单同一圈边框。 */
export function PickListFrame({ children }: { children: ReactNode }) {
  return <div className="pick-list__body">{children}</div>;
}

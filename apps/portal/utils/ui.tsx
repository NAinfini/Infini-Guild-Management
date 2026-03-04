import {
  Alert as MantineAlert,
  Badge as MantineBadge,
  Button as MantineButton,
  Card as MantineCard,
  Checkbox as MantineCheckbox,
  Drawer as MantineDrawer,
  Group,
  Indicator,
  Loader,
  Menu,
  Modal as MantineModal,
  MultiSelect,
  NumberInput,
  Popover as MantinePopover,
  Progress as MantineProgress,
  Select as MantineSelect,
  SegmentedControl,
  Slider as MantineSlider,
  Stack,
  Switch as MantineSwitch,
  Table as MantineTable,
  Tabs as MantineTabs,
  Text,
  TextInput,
  Textarea,
  Title,
  PasswordInput,
} from "@mantine/core";
import { InfiniMotionPagination } from "@infini-dev-kit/frontend/components";
import { notifications } from "@mantine/notifications";
import dayjs, { type Dayjs } from "dayjs";
import {
  Fragment,
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import { portalConfirm } from "../overlays";

type DataIndexPath = string | number | Array<string | number>;

type ColumnType<T> = {
  key?: string;
  title?: ReactNode;
  dataIndex?: keyof T | DataIndexPath;
  width?: string | number;
  render?: (value: unknown, record: T, index: number) => ReactNode;
};

export type ColumnsType<T = Record<string, unknown>> = Array<ColumnType<T>>;

export type DataNode = {
  key: string;
  title: ReactNode;
  children?: DataNode[];
  disabled?: boolean;
};

function mapAlertColor(type?: string): string {
  if (type === "error") return "red";
  if (type === "warning") return "yellow";
  if (type === "success") return "green";
  return "blue";
}

function mapTagColor(color?: string): string {
  if (!color || color === "default") return "gray";
  if (color === "gold") return "yellow";
  if (color === "processing") return "blue";
  return color;
}

function mapButtonVariant(type?: string): "filled" | "light" | "subtle" {
  if (type === "primary") return "filled";
  if (type === "text" || type === "link") return "subtle";
  return "light";
}

function mapSize(size?: string): "xs" | "sm" | "md" | "lg" {
  if (size === "small" || size === "xs") return "xs";
  if (size === "large" || size === "lg") return "md";
  if (size === "md") return "md";
  return "sm";
}

function toInputEvent(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const target = event.currentTarget as HTMLInputElement & HTMLTextAreaElement;
  return {
    target: {
      value: target.value,
      checked: (target as HTMLInputElement).checked,
      files: (target as HTMLInputElement).files ?? null,
    },
    currentTarget: {
      value: target.value,
      checked: (target as HTMLInputElement).checked,
      files: (target as HTMLInputElement).files ?? null,
    },
  };
}

function resolveDataIndex<T extends Record<string, unknown>>(
  row: T,
  dataIndex?: keyof T | DataIndexPath,
): unknown {
  if (!dataIndex) return row;
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[String(key)];
  }, row);
}

function readText(value: ReactNode, fallback = "Confirm"): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

type OptionLike = {
  value: unknown;
  label?: ReactNode;
  disabled?: boolean;
};

function normalizeOptions<T extends OptionLike>(
  options?: T[],
): Array<{ value: string; label: string; disabled?: boolean; raw: T["value"] }> {
  return (options ?? []).map((option) => ({
    value: String(option.value),
    label: typeof option.label === "string" ? option.label : String(option.label),
    disabled: option.disabled,
    raw: option.value,
  }));
}

function joinClassNames(...values: Array<string | undefined | null | false>): string | undefined {
  const className = values.filter(Boolean).join(" ");
  return className.length > 0 ? className : undefined;
}

export const Alert: any = ({ type, message, description, action, ...rest }: any) => (
  <MantineAlert color={mapAlertColor(type)} title={message} {...rest}>
    {description}
    {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
  </MantineAlert>
);

export const Badge: any = ({ dot, count, color, offset, children, ...rest }: any) => {
  if (dot || typeof count === "number") {
    return (
      <Indicator processing={Boolean(dot)} label={count} color={mapTagColor(color)} offset={offset}>
        <span>{children}</span>
      </Indicator>
    );
  }
  return (
    <MantineBadge color={mapTagColor(color)} {...rest}>
      {children}
    </MantineBadge>
  );
};

export const Breadcrumb: any = ({ items = [] }: any) => (
  <Group gap={6} wrap="wrap">
    {items.map((item: any, index: number) => (
      <Fragment key={`${index}-${readText(item.title)}`}>
        {index > 0 ? <Text c="dimmed">/</Text> : null}
        <Text>{item.title}</Text>
      </Fragment>
    ))}
  </Group>
);

export const Button: any = ({ type, danger, size, icon, children, htmlType, ...rest }: any) => (
  <MantineButton
    variant={mapButtonVariant(type)}
    color={danger ? "red" : undefined}
    size={mapSize(size)}
    leftSection={icon as ReactElement | undefined}
    type={htmlType ?? "button"}
    {...rest}
  >
    {children}
  </MantineButton>
);

export const Card: any = ({ title, extra, children, actions, bordered, size, className, ...rest }: any) => (
  <MantineCard className={joinClassNames("ant-card", className)} withBorder={bordered !== false} p={mapSize(size)} {...rest}>
    {title || extra ? (
      <Group justify="space-between" mb="sm">
        <div>{title}</div>
        <div>{extra}</div>
      </Group>
    ) : null}
    {children}
    {Array.isArray(actions) && actions.length > 0 ? <Group mt="md">{actions}</Group> : null}
  </MantineCard>
);

export const Checkbox: any = ({ onChange, children, ...rest }: any) => (
  <MantineCheckbox
    label={children}
    onChange={(event) => {
      const checked = event.currentTarget.checked;
      onChange?.({
        target: { checked },
        currentTarget: { checked },
      });
    }}
    {...rest}
  />
);

export const Descriptions: any = ({ items = [], bordered }: any) => (
  <Stack gap={8}>
    {items.map((item: any) => (
      <MantineCard key={item.key} withBorder={Boolean(bordered)} p="sm">
        <Text c="dimmed" size="sm">
          {item.label}
        </Text>
        <Text>{item.children}</Text>
      </MantineCard>
    ))}
  </Stack>
);

export const Dropdown: any = ({ menu, children }: any) => (
  <Menu withinPortal>
    <Menu.Target>{children as ReactElement}</Menu.Target>
    <Menu.Dropdown>
      {(menu?.items ?? []).map((item: any) => (
        <Menu.Item
          key={item.key}
          disabled={item.disabled}
          color={item.danger ? "red" : undefined}
          onClick={() => menu?.onClick?.({ key: item.key })}
        >
          {item.label}
        </Menu.Item>
      ))}
    </Menu.Dropdown>
  </Menu>
);

export const Select: any = ({ mode, options, value, onChange, allowClear, showSearch, filterOption, ...rest }: any) => {
  const { data, rawMap } = useMemo(() => {
    const normalized = normalizeOptions(options);
    return {
      data: normalized.map((item) => ({ value: item.value, label: item.label, disabled: item.disabled })),
      rawMap: new Map(normalized.map((item) => [item.value, item.raw])),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(options)]);

  if (mode === "multiple") {
    const nextValue = Array.isArray(value) ? value.map((item) => String(item)) : [];
    return (
      <MultiSelect
        data={data}
        value={nextValue}
        searchable={showSearch ?? true}
        clearable={allowClear}
        onChange={(next) => onChange?.(next.map((item) => rawMap.get(item) ?? item))}
        filter={
          filterOption
            ? ({ options: list, search }: any) =>
                list.filter((item: any) =>
                  filterOption(search.toLowerCase(), {
                    label: item.label,
                    value: item.value,
                  }),
                )
            : undefined
        }
        {...rest}
      />
    );
  }

  return (
    <MantineSelect
      data={data}
      value={value === undefined || value === null ? null : String(value)}
      searchable={showSearch ?? true}
      clearable={allowClear}
      onChange={(next) => onChange?.(next === null ? undefined : rawMap.get(next) ?? next)}
      filter={
        filterOption
          ? ({ options: list, search }: any) =>
              list.filter((item: any) =>
                filterOption(search.toLowerCase(), {
                  label: item.label,
                  value: item.value,
                }),
              )
          : undefined
      }
      {...rest}
    />
  );
};

export const Segmented: any = ({ options = [], value, onChange, ...rest }: any) => (
  <SegmentedControl
    data={options.map((item: any) => ({ value: String(item.value), label: item.label }))}
    value={value === undefined || value === null ? undefined : String(value)}
    onChange={(next) => {
      const match = options.find((item: any) => String(item.value) === next);
      onChange?.(match ? match.value : next);
    }}
    {...rest}
  />
);

const InputBase: any = ({ onChange, value, allowClear, ...rest }: any) => (
  <TextInput
    value={value}
    onChange={(event) => onChange?.(toInputEvent(event))}
    rightSection={
      allowClear && String(value ?? "").length > 0 ? (
        <button
          type="button"
          onClick={() => onChange?.({ target: { value: "" }, currentTarget: { value: "" } })}
          style={{ border: "none", background: "transparent", cursor: "pointer" }}
        >
          x
        </button>
      ) : undefined
    }
    {...rest}
  />
);

const InputSearch: any = ({ onChange, onSearch, value, allowClear, enterButton, ...rest }: any) => (
  <TextInput
    value={value}
    onChange={(event) => onChange?.(toInputEvent(event))}
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        onSearch?.(String((event.currentTarget as HTMLInputElement).value ?? value ?? ""));
      }
    }}
    {...rest}
  />
);

const InputTextArea: any = ({ onChange, value, rows, ...rest }: any) => (
  <Textarea value={value} minRows={rows} autosize onChange={(event) => onChange?.(toInputEvent(event))} {...rest} />
);

const InputPassword: any = ({ onChange, value, ...rest }: any) => (
  <PasswordInput value={value} onChange={(event) => onChange?.(toInputEvent(event))} {...rest} />
);

export const Input: any = Object.assign(InputBase, {
  Search: InputSearch,
  TextArea: InputTextArea,
  Password: InputPassword,
});

export const InputNumber: any = ({ onChange, ...rest }: any) => (
  <NumberInput
    onChange={(value) => {
      if (typeof value === "number") {
        onChange?.(value);
      } else {
        onChange?.(null);
      }
    }}
    {...rest}
  />
);

const ListBase: any = ({ dataSource = [], renderItem, locale }: any) => {
  if (dataSource.length === 0) {
    return <>{locale?.emptyText ?? null}</>;
  }
  return <ul style={{ margin: 0, padding: 0 }}>{dataSource.map((item: any, index: number) => <Fragment key={index}>{renderItem(item, index)}</Fragment>)}</ul>;
};

const ListItem: any = ({ children }: any) => <li style={{ listStyle: "none" }}>{children}</li>;

export const List: any = Object.assign(ListBase, {
  Item: ListItem,
});

const ModalBase: any = ({ open, title, onCancel, onOk, okText, cancelText, confirmLoading, footer, width, children, ...rest }: any) => (
  <MantineModal opened={Boolean(open)} onClose={() => onCancel?.()} title={title} size={typeof width === "number" ? `${width}px` : width} {...(rest as any)}>
    {children}
    {footer === null ? null : footer ?? (
      <Group justify="flex-end" mt="md">
        <Button onClick={() => onCancel?.()}>{cancelText ?? "Cancel"}</Button>
        <Button type="primary" onClick={() => onOk?.()} loading={confirmLoading}>
          {okText ?? "OK"}
        </Button>
      </Group>
    )}
  </MantineModal>
);

type ConfirmConfig = {
  title?: ReactNode;
  content?: ReactNode;
  okType?: string;
  danger?: boolean;
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
};

async function runConfirm(config: ConfirmConfig) {
  const contentText = readText(config?.content, "").trim();
  const confirmed = await portalConfirm({
    title: readText(config?.title),
    description: contentText.length > 0 ? contentText : undefined,
    intent: config?.okType === "danger" || config?.danger ? "danger" : "warning",
  });
  if (confirmed) {
    await config?.onOk?.();
    return;
  }
  config?.onCancel?.();
}

export const Modal: any = Object.assign(ModalBase, {
  confirm(config: ConfirmConfig) {
    void runConfirm(config);
    return {
      destroy() {
        // no-op
      },
    };
  },
});

export const Drawer: any = ({ open, onClose, title, width, placement, children, ...rest }: any) => (
  <MantineDrawer
    opened={Boolean(open)}
    onClose={() => onClose?.()}
    title={title}
    position={placement === "left" ? "left" : placement === "top" ? "top" : placement === "bottom" ? "bottom" : "right"}
    size={typeof width === "number" ? `${width}px` : width ?? "md"}
    {...(rest as any)}
  >
    {children}
  </MantineDrawer>
);

export const Popconfirm: any = ({ children, title, description, onConfirm, onCancel, okText, cancelText, disabled, ...rest }: any) => {
  const [opened, setOpened] = useState(false);
  if (disabled) {
    return <>{children}</>;
  }
  return (
    <MantinePopover opened={opened} onChange={setOpened} withinPortal {...rest}>
      <MantinePopover.Target>{children as ReactElement}</MantinePopover.Target>
      <MantinePopover.Dropdown>
        <Stack gap={8}>
          {title ? <Text fw={600}>{title}</Text> : null}
          {description ? <Text size="sm">{description}</Text> : null}
          <Group justify="flex-end" gap={6}>
            <Button
              onClick={() => {
                setOpened(false);
                onCancel?.();
              }}
            >
              {cancelText ?? "Cancel"}
            </Button>
            <Button
              type="primary"
              onClick={() => {
                setOpened(false);
                onConfirm?.();
              }}
            >
              {okText ?? "OK"}
            </Button>
          </Group>
        </Stack>
      </MantinePopover.Dropdown>
    </MantinePopover>
  );
};

export const Popover: any = ({ children, content, placement, ...rest }: any) => (
  <MantinePopover
    withinPortal
    position={placement?.startsWith("top") ? "top" : placement?.startsWith("left") ? "left" : placement?.startsWith("right") ? "right" : "bottom"}
    {...rest}
  >
    <MantinePopover.Target>{children as ReactElement}</MantinePopover.Target>
    <MantinePopover.Dropdown>{content}</MantinePopover.Dropdown>
  </MantinePopover>
);

export const Progress: any = ({ percent = 0, status, ...rest }: any) => (
  <MantineProgress value={percent} color={status === "exception" ? "red" : status === "success" ? "green" : "blue"} {...rest} />
);

export const Skeleton: any = ({ paragraph }: any) => {
  const rows = paragraph?.rows ?? 3;
  return (
    <Stack gap={8}>
      {Array.from({ length: rows }).map((_, index) => (
        <MantineProgress key={index} value={100} color="gray" />
      ))}
    </Stack>
  );
};

const SpaceBase = forwardRef<HTMLDivElement, any>(({ direction, size = 8, wrap, align, style, className, children, ...rest }, ref) => {
  const isVertical = direction === "vertical";
  return (
    <div
      ref={ref}
      className={joinClassNames("ant-space", className)}
      style={{
        display: "flex",
        flexDirection: isVertical ? "column" : "row",
        gap: size,
        flexWrap: wrap ? "wrap" : "nowrap",
        alignItems: align === "start" ? "flex-start" : align === "end" ? "flex-end" : "center",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});

const SpaceCompact: any = ({ children, ...rest }: any) => (
  <div style={{ display: "inline-flex", gap: 0 }} {...rest}>
    {children}
  </div>
);

export const Space: any = Object.assign(SpaceBase, {
  Compact: SpaceCompact,
});

export const Spin: any = ({ size = "sm", ...rest }: any) => <Loader size={mapSize(size)} {...rest} />;

export const Switch: any = ({ onChange, ...rest }: any) => (
  <MantineSwitch onChange={(event) => onChange?.(event.currentTarget.checked)} {...rest} />
);

export const Slider: any = (props: any) => <MantineSlider {...props} />;

type RowKey<T> = keyof T | ((record: T) => string | number);

function resolveRowKey<T extends Record<string, unknown>>(
  row: T,
  index: number,
  rowKey?: RowKey<T>,
): string | number {
  if (typeof rowKey === "function") return rowKey(row);
  if (typeof rowKey === "string") {
    const value = row?.[rowKey];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return index;
}

type TableRowSelection<T> = {
  selectedRowKeys?: Array<string | number>;
  onChange?: (selectedKeys: Array<string | number>, selectedRows: T[]) => void;
};

type TablePaginationConfig = {
  current?: number;
  pageSize?: number;
  total?: number;
  onChange?: (page: number, pageSize: number) => void;
};

type TableRowHandlers = {
  onDoubleClick?: MouseEventHandler<HTMLTableRowElement>;
};

type TableProps<T extends Record<string, unknown>> = {
  rowKey?: RowKey<T>;
  dataSource?: T[];
  columns?: ColumnsType<T>;
  rowSelection?: TableRowSelection<T>;
  pagination?: false | TablePaginationConfig;
  loading?: boolean;
  onRow?: (record: T, index: number) => TableRowHandlers;
};

export function Table<T extends Record<string, unknown>>({
  rowKey,
  dataSource = [],
  columns = [],
  rowSelection,
  pagination = false,
  loading,
  onRow,
}: TableProps<T>) {
  const [internalPage, setInternalPage] = useState(1);
  const paginationConfig = pagination && typeof pagination === "object" ? pagination : null;
  const currentPage = paginationConfig?.current ?? internalPage;
  const pageSize = paginationConfig?.pageSize ?? (dataSource.length || 1);
  const total = paginationConfig?.total ?? dataSource.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visibleRows = paginationConfig
    ? dataSource.slice((currentPage - 1) * pageSize, (currentPage - 1) * pageSize + pageSize)
    : dataSource;

  useEffect(() => {
    if (paginationConfig?.current) {
      setInternalPage(paginationConfig.current);
    }
  }, [paginationConfig?.current]);

  if (loading) {
    return <Spin />;
  }

  const selectedKeys = rowSelection?.selectedRowKeys ?? [];

  return (
    <Stack gap={10}>
      <MantineTable withTableBorder withColumnBorders striped>
        <MantineTable.Thead>
          <MantineTable.Tr>
            {rowSelection ? <MantineTable.Th style={{ width: 40 }} /> : null}
            {columns.map((column, index) => (
              <MantineTable.Th key={column.key ?? index} style={column.width ? { width: column.width } : undefined}>
                {column.title}
              </MantineTable.Th>
            ))}
          </MantineTable.Tr>
        </MantineTable.Thead>
        <MantineTable.Tbody>
          {visibleRows.map((row, index) => {
            const key = resolveRowKey(row, index, rowKey);
            const rowHandlers = onRow?.(row, index) ?? {};
            return (
              <MantineTable.Tr key={String(key)} onDoubleClick={rowHandlers.onDoubleClick}>
                {rowSelection ? (
                  <MantineTable.Td>
                    <MantineCheckbox
                      checked={selectedKeys.includes(key)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        const nextKeys = checked
                          ? [...selectedKeys, key]
                          : selectedKeys.filter((item) => item !== key);
                        const selectedRows = dataSource.filter((item, rowIndex) => {
                          const itemKey = resolveRowKey(item, rowIndex, rowKey);
                          return nextKeys.includes(itemKey);
                        });
                        rowSelection?.onChange?.(nextKeys, selectedRows);
                      }}
                    />
                  </MantineTable.Td>
                ) : null}
                {columns.map((column, colIndex) => {
                  const value = resolveDataIndex(row, column.dataIndex);
                  const content = column.render ? column.render(value, row, index) : value;
                  return <MantineTable.Td key={column.key ?? colIndex}>{content as React.ReactNode}</MantineTable.Td>;
                })}
              </MantineTable.Tr>
            );
          })}
        </MantineTable.Tbody>
      </MantineTable>
      {paginationConfig ? (
        <InfiniMotionPagination
          page={currentPage}
          total={totalPages}
          onChange={(nextPage) => {
            setInternalPage(nextPage);
            paginationConfig?.onChange?.(nextPage, pageSize);
          }}
        />
      ) : null}
    </Stack>
  );
}

export const Tabs: any = ({
  items = [],
  activeKey,
  defaultActiveKey,
  onChange,
  className,
  destroyInactiveTabPane,
  ...rest
}: any) => (
  <MantineTabs
    className={joinClassNames("ant-tabs", className)}
    value={activeKey}
    defaultValue={defaultActiveKey ?? items[0]?.key}
    keepMounted={!destroyInactiveTabPane}
    onChange={(value) => value && onChange?.(value)}
    {...rest}
  >
    <MantineTabs.List>
      {items.map((item: any) => (
        <MantineTabs.Tab key={item.key} value={item.key} disabled={item.disabled}>
          {item.label}
        </MantineTabs.Tab>
      ))}
    </MantineTabs.List>
    {items.map((item: any) => (
      <MantineTabs.Panel key={item.key} value={item.key} pt="sm">
        {item.children}
      </MantineTabs.Panel>
    ))}
  </MantineTabs>
);

export const Tag: any = ({ color, children, className, ...rest }: any) => (
  <MantineBadge className={joinClassNames("ant-tag", className)} color={mapTagColor(color)} variant="light" {...rest}>
    {children}
  </MantineBadge>
);

const TreeNode = ({ node, selectedKeys, onSelect, depth }: any) => {
  const isSelected = selectedKeys.includes(node.key);
  return (
    <li style={{ listStyle: "none", marginLeft: depth * 12 }}>
      <button
        type="button"
        disabled={node.disabled}
        onClick={() => onSelect?.([node.key])}
        style={{
          border: "none",
          background: "transparent",
          color: isSelected ? "var(--mantine-color-blue-6)" : "inherit",
          cursor: node.disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          padding: "4px 0",
        }}
      >
        {node.title}
      </button>
      {node.children?.length ? (
        <ul style={{ margin: 0, padding: 0 }}>
          {node.children.map((child: any) => (
            <TreeNode key={child.key} node={child} selectedKeys={selectedKeys} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
};

export const Tree: any = ({ treeData = [], selectedKeys = [], onSelect }: any) => (
  <ul style={{ margin: 0, padding: 0 }}>
    {treeData.map((node: any) => (
      <TreeNode key={node.key} node={node} selectedKeys={selectedKeys} onSelect={onSelect} depth={0} />
    ))}
  </ul>
);

const TypographyText: any = ({ strong, type, ellipsis, className, children, ...rest }: any) => (
  <Text
    className={joinClassNames("ant-typography", className)}
    fw={strong ? 700 : undefined}
    c={type === "secondary" ? "dimmed" : type === "warning" ? "yellow" : type === "danger" ? "red" : undefined}
    lineClamp={ellipsis?.rows}
    {...rest}
  >
    {children}
  </Text>
);

const TypographyTitle: any = ({ level = 4, className, children, ...rest }: any) => (
  <Title className={joinClassNames("ant-typography", className)} order={Math.min(6, Math.max(1, level))} {...rest}>
    {children}
  </Title>
);

const TypographyParagraph: any = ({ ellipsis, className, children, ...rest }: any) => (
  <Text className={joinClassNames("ant-typography", className)} component="p" lineClamp={ellipsis?.rows} {...rest}>
    {children}
  </Text>
);

export const Typography: any = {
  Text: TypographyText,
  Title: TypographyTitle,
  Paragraph: TypographyParagraph,
};

function startOfMonthGrid(base: Dayjs): Dayjs {
  return base.startOf("month").startOf("week");
}

export const Calendar: any = ({ value, onSelect, cellRender }: any) => {
  const active = value ? dayjs(value) : dayjs();
  const start = startOfMonthGrid(active);
  const days = Array.from({ length: 42 }).map((_, index) => start.add(index, "day"));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
      {days.map((day) => (
        <div
          key={day.format("YYYY-MM-DD")}
          role="button"
          tabIndex={0}
          onClick={() => onSelect?.(day)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect?.(day);
            }
          }}
          style={{
            minHeight: 54,
            borderRadius: 8,
            padding: 4,
            border: "1px solid color-mix(in srgb, var(--mantine-color-gray-4) 42%, transparent)",
            background: day.month() === active.month() ? "transparent" : "color-mix(in srgb, #000 4%, transparent)",
          }}
        >
          {cellRender ? cellRender(day) : <span style={{ fontSize: 12 }}>{day.date()}</span>}
        </div>
      ))}
    </div>
  );
};

export const DatePicker: any = ({ value, onChange, showTime, disabled, ...rest }: any) => {
  const inputValue = value ? dayjs(value).format(showTime ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD") : "";
  return (
    <TextInput
      type={showTime ? "datetime-local" : "date"}
      value={inputValue}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        const parsed = raw ? dayjs(raw) : null;
        const display = raw.replace("T", " ");
        onChange?.(parsed, display);
      }}
      {...rest}
    />
  );
};

export const Col: any = ({ span = 24, xs, sm, md, lg, xl, xxl, children, style, ...rest }: any) => {
  const effective = xxl ?? xl ?? lg ?? md ?? sm ?? xs ?? span;
  const width = `${(Math.max(1, Math.min(24, Number(effective) || 24)) / 24) * 100}%`;
  return (
    <div style={{ width, ...style }} {...rest}>
      {children}
    </div>
  );
};

export const Row: any = ({ gutter = 0, children, style, ...rest }: any) => {
  const [x, y] = Array.isArray(gutter) ? gutter : [gutter, 0];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: x, rowGap: y, ...style }} {...rest}>
      {children}
    </div>
  );
};

function useBreakpoint() {
  const [width, setWidth] = useState<number>(() => (typeof window === "undefined" ? 1920 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    xs: width >= 480,
    sm: width >= 576,
    md: width >= 768,
    lg: width >= 992,
    xl: width >= 1200,
    xxl: width >= 1600,
  };
}

export const Grid: any = {
  useBreakpoint,
};

function toast(color: string, value: any) {
  notifications.show({
    color,
    message: typeof value === "string" ? value : JSON.stringify(value),
    autoClose: 3500,
    withCloseButton: true,
  });
}

export const message: any = {
  success(value: any) {
    toast("green", value);
    return Promise.resolve();
  },
  warning(value: any) {
    toast("yellow", value);
    return Promise.resolve();
  },
  error(value: any) {
    toast("red", value);
    return Promise.resolve();
  },
  info(value: any) {
    toast("blue", value);
    return Promise.resolve();
  },
  destroy() {
    notifications.clean();
  },
};

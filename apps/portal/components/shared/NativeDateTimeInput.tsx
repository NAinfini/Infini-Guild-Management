import { formatCalendarParts } from "@portal/utils/datetime";
import { usePreferencesStore } from "@portal/stores/preferences";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  useCallback,
  useId,
  useMemo,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import "./NativeDateTimeInput.css";

type NativePickerType = "date" | "time" | "datetime-local";
type SupportedLocale = "en" | "zh";

/* 控件里的值是 <input type="date"> 的 YYYY-MM-DD：一个日历日期，不是瞬时点，
   所以走 formatCalendarParts 而不是任何按时区换算的格式化。 */
function formatLocalizedDate(value: ComponentProps<"input">["value"], locale: SupportedLocale): string {
  const rawValue = typeof value === "string"
    ? value
    : value == null
      ? ""
      : String(value);

  return formatCalendarParts(rawValue, locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: locale === "zh" ? "long" : "short",
    day: "numeric",
  });
}

/* 原生 <input type="date"> 只有右侧那颗日历图标能唤出选择器；点文字区只会把光标
   停在 mm / dd / yyyy 其中一段，看起来就是「点了没反应」。图标又只有十几像素宽，
   在 150px 的筛选框里很难命中，所以全站的日期／时间控件都被反馈成点不动。
   这里让整个控件都唤出选择器，行为和其它筛选控件一致。 */
export function NativeDateTimeInput({
  type = "date",
  onClick,
  className,
  style,
  w,
  size,
  label,
  description,
  error,
  id: providedId,
  ...props
}: Omit<ComponentProps<"input">, "type" | "size"> & {
  type?: NativePickerType;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  w?: CSSProperties["width"];
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}) {
  const locale = usePreferencesStore((state) => state.locale);
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const localizedDate = useMemo(
    () => type === "date" ? formatLocalizedDate(props.value, locale) : "",
    [locale, props.value, type],
  );
  const handleClick = useCallback((event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event);

    const input = event.currentTarget;
    if (input.disabled || input.readOnly) {
      return;
    }
    /* showPicker 需要用户手势，点击事件里调用是允许的。老浏览器上没有这个方法，
       此时仍然可以点右侧图标——那是浏览器自带行为，不是我们兜的底。 */
    if (typeof input.showPicker === "function") {
      input.showPicker();
    }
  }, [onClick]);

  const displayValue = localizedDate || props.placeholder || "";
  const wrapperClassName = className
    ? `native-date-time-field ${className}`
    : "native-date-time-field";
  const input = type === "date" ? (
    <div
      className="native-date-input"
      data-size={size ?? "sm"}
      data-empty={!localizedDate || undefined}
    >
      <Input
        {...props}
        id={id}
        className="native-date-input__field"
        type="date"
        aria-invalid={Boolean(error) || props["aria-invalid"] || undefined}
        onClick={handleClick}
      />
      <span className="native-date-input__display" aria-hidden="true">
        {displayValue}
      </span>
    </div>
  ) : (
    <Input
      {...props}
      id={id}
      type={type}
      aria-invalid={Boolean(error) || props["aria-invalid"] || undefined}
      onClick={handleClick}
    />
  );

  return (
    <div
      className={wrapperClassName}
      style={{ ...style, width: w ?? style?.width }}
      data-size={size ?? "sm"}
    >
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      {description ? <p className="native-date-time-field__description">{description}</p> : null}
      {input}
      {error ? <p className="native-date-time-field__error" role="alert">{error}</p> : null}
    </div>
  );
}

import { Box, TextInput, type TextInputProps } from "@mantine/core";
import { formatCalendarParts } from "@portal/utils/datetime";
import { usePreferencesStore } from "@portal/stores/preferences";
import { useCallback, useMemo, type MouseEvent } from "react";
import "./NativeDateTimeInput.css";

type NativePickerType = "date" | "time" | "datetime-local";
type SupportedLocale = "en" | "zh";

/* 控件里的值是 <input type="date"> 的 YYYY-MM-DD：一个日历日期，不是瞬时点，
   所以走 formatCalendarParts 而不是任何按时区换算的格式化。 */
function formatLocalizedDate(value: TextInputProps["value"], locale: SupportedLocale): string {
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
  ...props
}: Omit<TextInputProps, "type"> & { type?: NativePickerType }) {
  const locale = usePreferencesStore((state) => state.locale);
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

  if (type !== "date") {
    return (
      <TextInput
        {...props}
        className={className}
        style={style}
        w={w}
        size={size}
        type={type}
        onClick={handleClick}
      />
    );
  }

  const rootClassName = className
    ? `native-date-input ${className}`
    : "native-date-input";
  const displayValue = localizedDate || props.placeholder || "";

  return (
    <Box
      className={rootClassName}
      style={style}
      w={w}
      data-size={size ?? "sm"}
      data-empty={!localizedDate || undefined}
    >
      <TextInput
        {...props}
        className="native-date-input__field"
        size={size}
        type="date"
        onClick={handleClick}
      />
      <span className="native-date-input__display" aria-hidden="true">
        {displayValue}
      </span>
    </Box>
  );
}

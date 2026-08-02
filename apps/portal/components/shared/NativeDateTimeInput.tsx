import { TextInput, type TextInputProps } from "@mantine/core";
import { useCallback, type MouseEvent } from "react";

type NativePickerType = "date" | "time" | "datetime-local";

/* 原生 <input type="date"> 只有右侧那颗日历图标能唤出选择器；点文字区只会把光标
   停在 mm / dd / yyyy 其中一段，看起来就是「点了没反应」。图标又只有十几像素宽，
   在 150px 的筛选框里很难命中，所以全站的日期／时间控件都被反馈成点不动。
   这里让整个控件都唤出选择器，行为和其它筛选控件一致。 */
export function NativeDateTimeInput({
  type = "date",
  onClick,
  ...props
}: Omit<TextInputProps, "type"> & { type?: NativePickerType }) {
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

  return <TextInput {...props} type={type} onClick={handleClick} />;
}
